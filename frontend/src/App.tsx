import { useEffect, useRef, useState } from "react";
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
import { mountAsciiHero } from "./effects/asciiHero";
import { mountScrollSpark } from "./effects/scrollSpark";
import { scrambleOnIntersect } from "./effects/scramble";

const HERO_TEXT = "Optimistic Oracle";

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

  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  const sparkCanvasRef = useRef<HTMLCanvasElement>(null);
  const [heroActive, setHeroActive] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = heroCanvasRef.current;
    if (!canvas) return;
    setHeroActive(true);
    return mountAsciiHero(canvas, HERO_TEXT);
  }, []);

  useEffect(() => {
    const canvas = sparkCanvasRef.current;
    if (!canvas) return;
    return mountScrollSpark(canvas);
  }, []);

  useEffect(() => {
    const headings = document.querySelectorAll<HTMLElement>(".section-body h2");
    const cleanups = Array.from(headings).map((heading, i) => scrambleOnIntersect(heading, i * 80));
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  async function handleConnect() {
    await run("connect_wallet", async () => {
      const session = await connectWallet(clickRef);
      setPublicKeyHex(session.publicKeyHex);
      return session.publicKeyHex;
    });
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
    <>
      <canvas ref={sparkCanvasRef} className="scroll-spark-canvas" aria-hidden="true" />
      <main className="page">
        <header className="masthead">
          <div className="kicker">
            <span className="dot" />
            Live on Casper testnet
          </div>
          <canvas
            ref={heroCanvasRef}
            className="ascii-hero-canvas"
            aria-hidden="true"
            style={{ display: heroActive ? "block" : "none" }}
          />
          <h1 className="title">
            {heroActive ? <span className="visually-hidden">{HERO_TEXT}</span> : HERO_TEXT}
            {" + Prediction Market"}
          </h1>
        <p className="dek">
          Assert a claim, back it with a bond, let anyone dispute it, settle disputes by
          committee vote, then trade a market against the outcome. This UI's browser
          wallet-connect flow is unverified -- connect a Casper Wallet below to try it.
        </p>

        <div className="contracts">
          <a
            href="https://testnet.cspr.live/contract-package/9381589625613ac97d30f151a0fe53ba390c1259006f04d6347b20e87e5bb84c"
            target="_blank"
            rel="noreferrer"
          >
            <span className="label">Oracle contract</span>
            <span className="hash">9381589625613ac9...347b20e87e5bb84c</span>
          </a>
          <a
            href="https://testnet.cspr.live/contract-package/0a897d4de8d91d4236439b560e90edb57bcf7a7e6438d4160cc28f2d5d5d9cb2"
            target="_blank"
            rel="noreferrer"
          >
            <span className="label">Market contract</span>
            <span className="hash">0a897d4de8d91d42...60cc28f2d5d5d9cb2</span>
          </a>
        </div>

        <div style={{ marginTop: "1.75rem" }}>
          {publicKeyHex ? (
            <span className="wallet-pill">
              <span className="dot" />
              <code>
                {publicKeyHex.slice(0, 10)}…{publicKeyHex.slice(-6)}
              </code>
            </span>
          ) : (
            <button className="primary" onClick={handleConnect}>
              Connect wallet (CSPR.click)
            </button>
          )}
        </div>
      </header>

      <div className="section">
        <div className="section-num">01</div>
        <div className="section-body">
          <h2>Assert a claim</h2>
          <p className="hint">Post a claim backed by a CSPR bond. Starts the challenge window.</p>
          <div className="row">
            <input
              className="claim"
              placeholder="Team X won the match"
              value={claimText}
              onChange={(e) => setClaimText(e.target.value)}
            />
            <input
              className="number"
              type="number"
              value={bondCspr}
              onChange={(e) => setBondCspr(e.target.value)}
            />
            <span className="unit">CSPR bond</span>
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
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-num">02</div>
        <div className="section-body">
          <h2>Dispute / resolve / arbitrate</h2>
          <p className="hint">Challenge a claim, or settle it once the window closes.</p>
          <div className="row">
            <label className="field">
              Assertion id
              <input
                className="number"
                type="number"
                value={assertionId}
                onChange={(e) => setAssertionId(e.target.value)}
              />
            </label>
          </div>
          <div className="row">
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
            </button>
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
            </button>
          </div>
          <div className="row">
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
            </button>
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
            </button>
            <button
              onClick={() =>
                run("redeem_bond", () =>
                  redeemBond(clickRef, Number(assertionId), {
                    senderPublicKeyHex: requireWallet()
                  })
                )
              }
            >
              Redeem bond
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-num">03</div>
        <div className="section-body">
          <h2>Market</h2>
          <p className="hint">Trade against the outcome, then settle once it resolves.</p>
          <div className="row">
            <button
              onClick={() =>
                run("create_market", () =>
                  createMarket(clickRef, Number(assertionId), {
                    senderPublicKeyHex: requireWallet()
                  })
                )
              }
            >
              Create market for assertion {assertionId}
            </button>
          </div>

          <div className="row">
            <label className="field">
              Market id
              <input
                className="number"
                type="number"
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
              />
            </label>
            <input
              className="number"
              type="number"
              value={buyAmountCspr}
              onChange={(e) => setBuyAmountCspr(e.target.value)}
            />
            <span className="unit">CSPR</span>
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
            </button>
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

          <div className="row">
            <button
              onClick={() =>
                run("resolve_market", () =>
                  resolveMarket(clickRef, Number(marketId), {
                    senderPublicKeyHex: requireWallet()
                  })
                )
              }
            >
              Resolve market
            </button>
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
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="section">
        <div className="section-num">04</div>
        <div className="section-body">
          <h2>Deploy log</h2>
          <div className="log">
            {entries.length === 0 ? (
              <span className="empty">No transactions yet this session.</span>
            ) : (
              <ul>
                {entries.map((entry, i) => (
                  <li key={i}>
                    <span className="log-label">{entry.label}</span>
                    <span className="log-result">{entry.result}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        </div>
      </main>
    </>
  );
}
