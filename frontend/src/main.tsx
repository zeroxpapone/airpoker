import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom"; // torna BrowserRouter
import "./styles/index.css";
import "./i18n"; // Importa la configurazione i18next
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter> {/* BrowserRouter senza basename */}
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
