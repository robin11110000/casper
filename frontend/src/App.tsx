import { useState } from "react";
import { useClickRef } from "@make-software/csprclick-ui";
import { connectWallet } from "./services/casperClient";
import {
  arbitrate,
  assertClaim,
  buyPosition,
  claimPayout,
  createMarket,
  disputeAssertion,
  redeemBond,
  resolveAssertion,
  resolveMarket
} from "./services/oracleMarket";

/**
 * Deploys submitted this session, tracked client-side only. There is no on-chain
 * state reader wired up yet (would need RPC `query_global_state`/dictionary reads
 * against the deployed contract's named keys) -- ids typed in below are assumed to
 * be known out of band (e.g. from a block explorer or the deploy result) rather than
 * fetched from the contract. See README's "Frontend" section.
 */
interface DeployLogEntry {
  label: string;
  result: string;
}

function useDeployLog() {
  const [entries, setEntries] = useState<DeployLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<unknown>) {
    setError(null);
    try {
      const result = await action();
      setEntries((prev) => [{ label, result: JSON.stringify(result) }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return { entries, error, run };
}

export function App() {
  const clickRef = useClickRef();
  const [publicKeyHex, setPublicKeyHex] = useState<string | null>(null);
  const { entries, error, run } = useDeployLog();

  const [claimText, setClaimText] = useState("");
  const [bondCspr, setBondCspr] = useState("10");

  const [assertionId, setAssertionId] = useState("0");
  const [marketId, setMarketId] = useState("0");
  const [buyAmountCspr, setBuyAmountCspr] = useState("5");

  async function handleConnect() {
    const session = await connectWallet(clickRef);
    setPublicKeyHex(session.publicKeyHex);
  }

  function csprToMotes(cspr: string): string {
    return BigInt(Math.round(parseFloat(cspr || "0") * 1_000_000_000)).toString();
  }

  function requireWallet(): string {
    if (!publicKeyHex) {
      throw new Error("Connect a wallet first");
    }
    return publicKeyHex;
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Casper Optimistic Oracle + Prediction Market</h1>
      <p style={{ color: "#666" }}>
        Scaffold UI, not yet run against a live wallet or deployed contract -- see the
        repo README before demoing.
      </p>

      <section>
        <h2>Wallet</h2>
        {publicKeyHex ? (
          <p>
            Connected: <code>{publicKeyHex}</code>
          </p>
        ) : (
          <button onClick={handleConnect}>Connect wallet (CSPR.click)</button>
        )}
      </section>

      <section>
        <h2>1. Assert a claim</h2>
        <input
          placeholder="Team X won the match"
          value={claimText}
          onChange={(e) => setClaimText(e.target.value)}
          style={{ width: "60%" }}
        />
        <input
          type="number"
          value={bondCspr}
          onChange={(e) => setBondCspr(e.target.value)}
          style={{ width: 80, marginLeft: 8 }}
        />
        <span> CSPR bond </span>
        <button
          onClick={() =>
            run("assert_claim", () =>
              assertClaim(clickRef, claimText, csprToMotes(bondCspr), {
                senderPublicKeyHex: requireWallet()
              })
            )
          }
        >
          Assert
        </button>
      </section>

      <section>
        <h2>2. Dispute / resolve / arbitrate</h2>
        <label>
          Assertion id:{" "}
          <input
            type="number"
            value={assertionId}
            onChange={(e) => setAssertionId(e.target.value)}
            style={{ width: 60 }}
          />
        </label>
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() =>
              run("dispute_assertion", () =>
                disputeAssertion(clickRef, Number(assertionId), csprToMotes(bondCspr), {
                  senderPublicKeyHex: requireWallet()
                })
              )
            }
          >
            Dispute (counter-bond = bond field above)
          </button>{" "}
          <button
            onClick={() =>
              run("resolve_assertion", () =>
                resolveAssertion(clickRef, Number(assertionId), {
                  senderPublicKeyHex: requireWallet()
                })
              )
            }
          >
            Resolve (undisputed, window closed)
          </button>{" "}
          <button
            onClick={() =>
              run("arbitrate(true)", () =>
                arbitrate(clickRef, Number(assertionId), true, {
                  senderPublicKeyHex: requireWallet()
                })
              )
            }
          >
            Arbitrate: claim held
          </button>{" "}
          <button
            onClick={() =>
              run("arbitrate(false)", () =>
                arbitrate(clickRef, Number(assertionId), false, {
                  senderPublicKeyHex: requireWallet()
                })
              )
            }
          >
            Arbitrate: claim rejected
          </button>{" "}
          <button
            onClick={() =>
              run("redeem_bond", () =>
                redeemBond(clickRef, Number(assertionId), { senderPublicKeyHex: requireWallet() })
              )
            }
          >
            Redeem bond
          </button>
        </div>
      </section>

      <section>
        <h2>3. Market</h2>
        <button
          onClick={() =>
            run("create_market", () =>
              createMarket(clickRef, Number(assertionId), { senderPublicKeyHex: requireWallet() })
            )
          }
        >
          Create market for assertion {assertionId}
        </button>

        <div style={{ marginTop: 12 }}>
          <label>
            Market id:{" "}
            <input
              type="number"
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              style={{ width: 60 }}
            />
          </label>{" "}
          <input
            type="number"
            value={buyAmountCspr}
            onChange={(e) => setBuyAmountCspr(e.target.value)}
            style={{ width: 80 }}
          />
          <span> CSPR </span>
          <button
            onClick={() =>
              run("buy_position(YES)", () =>
                buyPosition(clickRef, Number(marketId), "yes", csprToMotes(buyAmountCspr), {
                  senderPublicKeyHex: requireWallet()
                })
              )
            }
          >
            Buy YES
          </button>{" "}
          <button
            onClick={() =>
              run("buy_position(NO)", () =>
                buyPosition(clickRef, Number(marketId), "no", csprToMotes(buyAmountCspr), {
                  senderPublicKeyHex: requireWallet()
                })
              )
            }
          >
            Buy NO
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <button
            onClick={() =>
              run("resolve_market", () =>
                resolveMarket(clickRef, Number(marketId), { senderPublicKeyHex: requireWallet() })
              )
            }
          >
            Resolve market
          </button>{" "}
          <button
            onClick={() =>
              run("claim_payout", () =>
                claimPayout(clickRef, Number(marketId), { senderPublicKeyHex: requireWallet() })
              )
            }
          >
            Claim payout
          </button>
        </div>
      </section>

      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      <section>
        <h2>Deploy log</h2>
        <ul>
          {entries.map((entry, i) => (
            <li key={i}>
              {entry.label}: <code>{entry.result}</code>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
