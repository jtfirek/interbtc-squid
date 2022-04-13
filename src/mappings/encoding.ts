import * as ss58 from "@subsquid/ss58";
import { Network } from "bitcoinjs-lib";
import {Token} from "../model";

import { Address, CurrencyId_Token, VaultId } from "../types/v0";
import { encodeBtcAddress, getBtcNetwork } from "./bitcoinUtils";

const bitcoinNetwork: Network = getBtcNetwork(process.env.BITCOIN_NETWORK);
const ss58format = process.env.SS58_CODEC || "substrate";

export const address = {
    interlay: ss58.codec(ss58format),
    btc: {
        encode(address: Address): string | undefined {
            return encodeBtcAddress(address, bitcoinNetwork);
        },
    },
};

export const currencyId = {
    token: {
        encode(token: CurrencyId_Token) {
            return Token[token.value.__kind];
        },
    },
};

export function encodeVaultId(vaultId: VaultId) {
    const addressStr = address.interlay.encode(vaultId.accountId).toString();
    const wrappedStr = currencyId.token.encode(vaultId.currencies.wrapped).toString();
    const collateralStr = currencyId.token.encode(vaultId.currencies.collateral).toString();
    return `${addressStr}-${wrappedStr}-${collateralStr}`;
}