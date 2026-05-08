import React from "react";
import ReactDOM from "react-dom/client";
import "plyr/dist/plyr.css";
import "./styles.css";
import { App } from "./App";
import { initTelegramWebApp } from "./telegramWebApp";

initTelegramWebApp();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

