import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { SharedPlaceCard } from "./SharedPlaceCard.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
function render() {
  const params = new URLSearchParams(location.hash.slice(1));
  root.render(
    params.has("card") ? (
      <SharedPlaceCard token={params.get("card")!} />
    ) : (
      <App />
    ),
  );
}
render();
window.addEventListener("hashchange", render);
