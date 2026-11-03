import { createRoot } from "react-dom/client";
import SeaGatesGame from "../app/sea-gates-game";
import "../app/globals.css";

createRoot(document.getElementById("sea-gates")!).render(
  <SeaGatesGame initialAccount={null} signInHref="" signOutHref="" deviceOnly />,
);
