import { Network, networks, payments } from "bitcoinjs-lib";
import { Address } from "../types/v1";

export function getBtcNetwork(network?: string): Network {
    switch (network) {
        case "mainnet":
        case "bitcoin":
            return networks.bitcoin;
        case "testnet":
            return networks.testnet;
        case "regtest":
        default:
            return networks.regtest;
    }
}

export function encodeBtcAddress(
    addressObject: Address,
    network: Network
): string | undefined {
    let payment;
    switch (addressObject.__kind) {
        case "P2SH":
            payment = payments.p2sh;
            break;
        case "P2PKH":
            payment = payments.p2pkh;
            break;
        case "P2WSHv0":
            payment = payments.p2wsh;
            break;
        case "P2WPKHv0":
            payment = payments.p2wpkh;
            break;
        default:
            return undefined;
    }
    const hash = Buffer.from(addressObject.value);
    return payment({ hash, network }).address;
}
