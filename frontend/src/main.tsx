import React from "react";
import ReactDOM from "react-dom/client";
import { ClickProvider } from "@make-software/csprclick-ui";
import { App } from "./App";
import { config } from "./config";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClickProvider
      options={{
        appName: "Casper Optimistic Oracle + Prediction Market",
        appId: config.csprClickAppId,
        contentMode: "Popup",
        providers: ["casper-wallet"],
        chainName: config.networkName
      }}
    >
      <App />
    </ClickProvider>
  </React.StrictMode>
);
