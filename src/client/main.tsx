import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { SharedPlaceCard } from "./SharedPlaceCard.js";
import { HelperPage } from "./HelperPage.js";
import { FamilyViewer } from "./FamilyPanel.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
function render() {
  const params = new URLSearchParams(location.hash.slice(1));
  root.render(
    params.has("family") ? (
      <FamilyViewer
        key={location.hash}
        id={params.get("family")!}
        token={params.get("key") ?? ""}
      />
    ) : params.has("assist") ? (
      <HelperPage
        key={location.hash}
        id={params.get("assist")!}
        token={params.get("key") ?? ""}
      />
    ) : params.has("card") ? (
      <SharedPlaceCard token={params.get("card")!} />
    ) : (
      <App />
    ),
  );
}
render();
window.addEventListener("hashchange", render);
