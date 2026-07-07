/**
 * Thin wrapper around CSPR.click (wallet connect + signing) and the Casper JS SDK
 * (transaction building/sending). Kept isolated from UI components so the rest of
 * the app only ever talks to the typed functions below, not raw SDK/wallet calls.
 *
 * NOT exercised against a live wallet or a deployed contract in this session -- there
 * is no browser + wallet extension + funded testnet account available here. The
 * shapes below were checked against the installed package type declarations
 * (`@make-software/csprclick-ui`, `@make-software/csprclick-core-types`,
 * `casper-js-sdk`), but the actual signing round trip (`sdk.sign` -> submitting the
 * result via `RpcClient.putTransaction`) is unverified. Treat this as a starting
 * point, not confirmed working code.
 */
import type { ICSPRClickSDK } from "@make-software/csprclick-core-types";
import {
  Args,
  CLValue,
  ContractCallBuilder,
  HttpHandler,
  PublicKey,
  RpcClient,
  Transaction
} from "casper-js-sdk";
import { config } from "../config";

export interface WalletSession {
  publicKeyHex: string;
}

const rpcClient = new RpcClient(new HttpHandler(config.nodeRpcUrl));

/** Opens the CSPR.click sign-in flow and resolves once a wallet is connected. */
export function connectWallet(clickRef: ICSPRClickSDK | undefined): Promise<WalletSession> {
  return new Promise((resolve, reject) => {
    if (!clickRef) {
      reject(
        new Error(
          "CSPR.click SDK hasn't finished loading yet -- it loads an external script " +
            "asynchronously (window.csprclick), so clicking Connect immediately on page " +
            "load can race it. Wait a moment and try again."
        )
      );
      return;
    }

    const timeout = setTimeout(() => {
      reject(
        new Error(
          "Wallet connect timed out after 30s. Do you have the Casper Wallet browser " +
            "extension installed? (CSPR.click is configured with providers: " +
            "['casper-wallet'] only.) Also check that VITE_CSPRCLICK_APP_ID is a real " +
            "app id registered for this domain at console.cspr.build, not left blank."
        )
      );
    }, 30_000);

    clickRef.once("csprclick:signed_in", (event: { account?: { public_key?: string } }) => {
      clearTimeout(timeout);
      if (!event.account?.public_key) {
        reject(new Error("Wallet connected but no public key was returned"));
        return;
      }
      resolve({ publicKeyHex: event.account.public_key });
    });
    clickRef.signIn();
  });
}

interface EntryPointCallArgs {
  contractPackageHash: string;
  entryPoint: string;
  runtimeArgs: Record<string, CLValue>;
  senderPublicKeyHex: string;
  paymentMotes?: number;
  /** Native token amount to attach, for `#[odra(payable)]` entry points. */
  attachedMotes?: string;
}

/**
 * Builds a contract-call transaction, requests a signature via CSPR.click, then
 * submits it through the configured RPC node.
 *
 * TODO(unverified): Odra's `#[odra(payable)]` entry points (assert_claim,
 * dispute_assertion, buy_position) need the attached native-token amount wired into
 * the call per https://odra.dev/docs/backends/casper -- the `amount` runtime arg
 * below is a best guess, not confirmed against a real deployment. Similarly, the
 * exact shape `sdk.sign(...)` resolves with (and how to turn that into something
 * `RpcClient.putTransaction` accepts) is not confirmed here.
 */
export async function callEntryPoint(
  clickRef: ICSPRClickSDK,
  {
    contractPackageHash,
    entryPoint,
    runtimeArgs,
    senderPublicKeyHex,
    paymentMotes = Number(config.defaultPaymentMotes),
    attachedMotes
  }: EntryPointCallArgs
) {
  const sender = PublicKey.fromHex(senderPublicKeyHex);
  const args = Args.fromMap(
    attachedMotes !== undefined
      ? { ...runtimeArgs, amount: CLValue.newCLUInt512(attachedMotes) }
      : runtimeArgs
  );

  const transaction = new ContractCallBuilder()
    .from(sender)
    .byPackageHash(contractPackageHash)
    .entryPoint(entryPoint)
    .runtimeArgs(args)
    .chainName(config.networkName)
    .payment(paymentMotes)
    .build();

  const signResult = await clickRef.sign(JSON.stringify(transaction), senderPublicKeyHex);
  if (!signResult) {
    throw new Error("Signing was cancelled");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = signResult as any;
  return rpcClient.putTransaction(
    (signed.signedTransaction ?? signed.signedDeploy ?? signed) as Transaction
  );
}
