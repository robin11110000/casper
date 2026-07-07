import React from "react";
import ReactDOM from "react-dom/client";
import { ClickProvider } from "@make-software/csprclick-ui";
import { CONTENT_MODE, WALLET_KEYS } from "@make-software/csprclick-core-types";
import { App } from "./App";
import { config } from "./config";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClickProvider
      options={{
        appName: "Casper Optimistic Oracle + Prediction Market",
        appId: config.csprClickAppId,
        contentMode: CONTENT_MODE.POPUP,
        providers: [WALLET_KEYS.CASPER_WALLET],
        chainName: config.networkName
      }}
    >
      <App />
    </ClickProvider>
  </React.StrictMode>
);
