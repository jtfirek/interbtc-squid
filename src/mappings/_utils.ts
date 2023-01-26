import { Entity, Store } from "@subsquid/typeorm-store";
import { ForeignAsset, Height, Issue, Redeem, Vault } from "../model";
import { VaultId as VaultIdV15 } from "../types/v15";
import { VaultId as VaultIdV17 } from "../types/v17";
import { VaultId as VaultIdV6 } from "../types/v6";
import { VaultId as VaultIdV1020000 } from "../types/v1020000";
import { VaultId as VaultIdV1021000 } from "../types/v1021000";
import { encodeLegacyVaultId, encodeVaultId } from "./encoding";
import { Currency } from "../model";
import { CurrencyIdentifier, currencyIdToMonetaryCurrency,newMonetaryAmount, CurrencyExt} from "@interlay/interbtc-api";
import { getInterBtcApi } from "../processor";
import { BigDecimal } from "@subsquid/big-decimal";

export type eventArgs = {
    event: { args: true };
};
export type eventArgsData = {
    data: eventArgs;
};

const parachainBlocksPerBitcoinBlock = 100; // TODO: HARDCODED - find better way to set?

export async function getVaultIdLegacy(
    store: Store,
    vaultId: VaultIdV15 | VaultIdV6
) {
    return store.get(Vault, {
        where: { id: encodeLegacyVaultId(vaultId) },
    });
}

export async function getVaultId(store: Store, vaultId: VaultIdV1020000 | VaultIdV1021000) {
    return store.get(Vault, {
        where: { id: encodeVaultId(vaultId) },
    });
}

export async function isRequestExpired(
    store: Store,
    request: Issue | Redeem,
    latestBtcBlock: number,
    latestActiveBlock: number,
    period: number
): Promise<boolean> {
    const requestHeight = await store.get(Height, {
        where: { id: request.request.height },
    });
    if (requestHeight === undefined) return false; // no active blocks yet

    const btcPeriod = Math.ceil(period / parachainBlocksPerBitcoinBlock);

    return (
        request.request.backingHeight + btcPeriod < latestBtcBlock &&
        requestHeight.active + period < latestActiveBlock
    );
}

let currencyMap = new Map<CurrencyIdentifier, CurrencyExt>();

export async function currencyToLibCurrencyExt(currency: Currency): Promise<CurrencyExt> {
    const interBtcApi = await getInterBtcApi();

    let id: CurrencyIdentifier;
    if (currency.isTypeOf === "NativeToken") {
        id = {token: currency.token};
    }
    else if (currency.isTypeOf === "ForeignAsset") {
        id = {foreignAsset: currency.asset };
    }
    else if (currency.isTypeOf === "LendToken") {
        id = {lendToken: currency.lendTokenId};
    }
    else {
       throw new Error("No handling implemented for currency type");
    }
    let currencyInfo: CurrencyExt;
    if ( currencyMap.has(id) ) {
        currencyInfo = currencyMap.get(id) as CurrencyExt;
    }
    else {
        const currencyId = interBtcApi.api.createType("InterbtcPrimitivesCurrencyId", id );
        currencyInfo  = await currencyIdToMonetaryCurrency(
            interBtcApi.assetRegistry,
            interBtcApi.loans,
            currencyId
        )

        currencyMap.set(id , currencyInfo);
    }
    return currencyMap.get(id) as CurrencyExt;
}

export async function convertAmountToHuman(currency: Currency, amount: bigint ) : Promise<BigDecimal> {
    const currencyInfo: CurrencyExt = await currencyToLibCurrencyExt(currency);
    const monetaryAmount = newMonetaryAmount(amount.toString(), currencyInfo);
    return BigDecimal(monetaryAmount.toString());
}