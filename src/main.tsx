import React from "react";
import ReactDOM from "react-dom/client";
import "plyr/dist/plyr.css";
import "./styles.css";
import { App } from "./App";
import { initApiBase } from "./apiBase";
import { initTelegramWebApp } from "./telegramWebApp";

initTelegramWebApp();

void initApiBase().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

