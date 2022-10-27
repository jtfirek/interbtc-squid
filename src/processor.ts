import {
    BatchContext,
    BatchProcessorCallItem,
    BatchProcessorEventItem,
    BatchProcessorItem,
    SubstrateBatchProcessor,
    SubstrateBlock,
} from "@subsquid/substrate-processor";
import {
    CallItem as _CallItem,
    EventItem as _EventItem,
} from "@subsquid/substrate-processor/lib/interfaces/dataSelection";
import { Store, TypeormDatabase } from "@subsquid/typeorm-store";
import assert from "assert";
import {
    cancelIssue,
    cancelRedeem,
    decreaseLockedCollateral,
    executeIssue,
    executeRedeem,
    feedValues,
    findAndUpdateExpiredRequests,
    increaseLockedCollateral,
    issuePeriodChange,
    redeemPeriodChange,
    registerVault,
    requestIssue,
    requestRedeem,
    setStorage,
    storeMainChainHeader,
    updateActiveBlock,
} from "./mappings";
import { deposit, withdraw } from "./mappings/event/escrow";
import { tokensTransfer } from "./mappings/event/transfer";
import * as heights from "./mappings/utils/heights";
import EntityBuffer from "./mappings/utils/entityBuffer";
import { eventArgsData } from "./mappings/_utils";

const archive = process.env.ARCHIVE_ENDPOINT;
assert(!!archive);
const chain = process.env.CHAIN_ENDPOINT;
assert(!!chain);

const processFrom = Number(process.env.PROCESS_FROM) || 0;

const eventArgsData: eventArgsData = {
    data: {
        event: { args: true },
    },
};

const processor = new SubstrateBatchProcessor()
    .setDataSource({ archive, chain })
    .setTypesBundle("indexer/typesBundle.json")
    .setBlockRange({ from: processFrom })
    .setBatchSize(1000)
    .addEvent("BTCRelay.StoreMainChainHeader", eventArgsData)
    .addEvent("Escrow.Deposit", eventArgsData)
    .addEvent("Escrow.Withdraw", eventArgsData)
    .addEvent("Issue.CancelIssue", eventArgsData)
    .addEvent("Issue.ExecuteIssue", eventArgsData)
    .addEvent("Issue.RequestIssue", eventArgsData)
    .addEvent("Issue.IssuePeriodChange", eventArgsData)
    .addEvent("Oracle.FeedValues", eventArgsData)
    .addEvent("Redeem.CancelRedeem", eventArgsData)
    .addEvent("Redeem.ExecuteRedeem", eventArgsData)
    .addEvent("Redeem.RequestRedeem", eventArgsData)
    .addEvent("Redeem.RedeemPeriodChange", eventArgsData)
    .addEvent("Security.UpdateActiveBlock", eventArgsData)
    .addEvent("Tokens.Transfer", eventArgsData)
    .addEvent("VaultRegistry.RegisterVault", eventArgsData)
    .addEvent("VaultRegistry.IncreaseLockedCollateral", eventArgsData)
    .addEvent("VaultRegistry.DecreaseLockedCollateral", eventArgsData)
    .addEvent("Sudo.Sudid", eventArgsData)
    .addCall("System.set_storage", {
        data: {
            call: true,
            extrinsic: {
                signature: true,
                call: true,
            },
        },
    })
    // .addCall("System.set_storage", {
    //     data: {
    //         extrinsic: {
    //             signature: true,
    //             call: true,
    //         },
    //     },
    // })
    .addCall("BTCRelay.store_block_header", {
        data: {
            extrinsic: {
                signature: true,
                call: true,
            },
        },
    });

export type Item = BatchProcessorItem<typeof processor>;
export type EventItem = Exclude<
    BatchProcessorEventItem<typeof processor>,
    _EventItem<"*", false>
>;
export type CallItem = Exclude<
    BatchProcessorCallItem<typeof processor>,
    _CallItem<"*", false>
>;
export type Ctx = BatchContext<Store, Item>;

processor.run(new TypeormDatabase({ stateSchema: "interbtc" }), async (ctx) => {
    type MappingsList = Array<{
        filter: { name: string };
        mapping: (
            ctx: Ctx,
            block: SubstrateBlock,
            item: EventItem,
            entityBuffer: EntityBuffer
        ) => Promise<void>;
        totalTime: number;
    }>;

    const entityBuffer = new EntityBuffer();

    // helper function to loop through the events only once,
    // apply each of a list of mappings and batch save the resulting data
    const processConcurrently = async (mappings: MappingsList) => {
        const processingStartTime = Date.now();
        for (const block of ctx.blocks) {
            for (const item of block.items) {
                if (item.kind === "event") {
                    for (const mapping of mappings) {
                        if (
                            mapping.filter.name === item.name &&
                            item.name !== "*"
                        ) {
                            const execStartTime = Date.now();
                            await mapping.mapping(
                                ctx,
                                block.header,
                                item,
                                entityBuffer
                            );
                            mapping.totalTime += Date.now() - execStartTime;
                        }
                    }
                }

                if (
                    item.kind === "call" &&
                    item.name === "System.set_storage"
                ) {
                    await setStorage(ctx, block.header, item);
                }
            }
        }

        for (const mapping of mappings) {
            ctx.log.trace(
                `For mapping ${mapping.filter.name}, processing time of batch is ${mapping.totalTime}`
            );
            mapping.totalTime = 0;
        }

        const dbStartTime = Date.now();
        await entityBuffer.flush(ctx.store);
        ctx.log.debug(
            `Processing time for batch: ${
                dbStartTime - processingStartTime
            }ms; db time: ${Date.now() - dbStartTime}`
        );
    };

    // pre-stage
    // first we process all active block heights to immediately populate the
    // in-memory cache which eliminates a huge amount of redundant database lookups
    // 1. security
    await processConcurrently([
        {
            filter: { name: "Security.UpdateActiveBlock" },
            mapping: updateActiveBlock,
            totalTime: 0,
        },
    ]);

    // first stage
    // - transfers
    // - oracle events
    // - vault registrations and collateral changes
    // - btcrelay events
    //TODO    // 6. vault activity probe
    // - issue period
    // - redeem period
    // - escrow
    await processConcurrently([
        {
            filter: { name: "Tokens.Transfer" },
            mapping: tokensTransfer,
            totalTime: 0,
        },
        {
            filter: { name: "Oracle.FeedValues" },
            mapping: feedValues,
            totalTime: 0,
        },
        {
            filter: { name: "VaultRegistry.RegisterVault" },
            mapping: registerVault,
            totalTime: 0,
        },
        {
            filter: { name: "VaultRegistry.IncreaseLockedCollateral" },
            mapping: increaseLockedCollateral,
            totalTime: 0,
        },
        {
            filter: { name: "VaultRegistry.DecreaseLockedCollateral" },
            mapping: decreaseLockedCollateral,
            totalTime: 0,
        },
        {
            filter: { name: "BTCRelay.StoreMainChainHeader" },
            mapping: storeMainChainHeader,
            totalTime: 0,
        },
        {
            filter: { name: "Issue.IssuePeriodChange" },
            mapping: issuePeriodChange,
            totalTime: 0,
        },
        {
            filter: { name: "Redeem.RedeemPeriodChange" },
            mapping: redeemPeriodChange,
            totalTime: 0,
        },
        {
            filter: { name: "Escrow.Deposit" },
            mapping: deposit,
            totalTime: 0,
        },
        {
            filter: { name: "Escrow.Withdraw" },
            mapping: withdraw,
            totalTime: 0,
        },
    ]);

    // second stage
    // after the above are saved, we process:
    // - issue requests - depends on vault registrations
    // - redeem requests - depends on vault registrations
    await processConcurrently([
        {
            filter: { name: "Issue.RequestIssue" },
            mapping: requestIssue,
            totalTime: 0,
        },
        {
            filter: { name: "Redeem.RequestRedeem" },
            mapping: requestRedeem,
            totalTime: 0,
        },
    ]);

    // third stage
    // - issue cancellations - depends on issue requests
    // - issue executions - depends on issue requests
    // - redeem cancellation - depends on redeem requests
    // - redeem execution - depends on redeem requests
    // Executions also update the respective cumulative volumes (TVL).
    await processConcurrently([
        {
            filter: { name: "Issue.CancelIssue" },
            mapping: cancelIssue,
            totalTime: 0,
        },
        {
            filter: { name: "Issue.ExecuteIssue" },
            mapping: executeIssue,
            totalTime: 0,
        },
        {
            filter: { name: "Redeem.CancelRedeem" },
            mapping: cancelRedeem,
            totalTime: 0,
        },
        {
            filter: { name: "Redeem.ExecuteRedeem" },
            mapping: executeRedeem,
            totalTime: 0,
        },
    ]);

    // finally, check request expiration, once all events have been processed
    await findAndUpdateExpiredRequests(ctx);

    heights.clearCache();
});
