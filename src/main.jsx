import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PublicExam from "./PublicExam.jsx";
import "./styles.css";

const examRoute = window.location.pathname.match(/^\/exam\/([^/]+)\/?$/i);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {examRoute ? <PublicExam shareId={examRoute[1]} /> : <App />}
  </React.StrictMode>
);
