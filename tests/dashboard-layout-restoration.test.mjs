import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const appCss = readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");
const navigationCss = readFileSync(new URL("../src/styles/page-back-next-navigation.css", import.meta.url), "utf8");

test("shared Back/Next navigation retains its original three-part portal layout", () => {
  const start = app.indexOf("function PageBackNextNavigation");
  const end = app.indexOf("function PortalNavigationFreeze", start);
  assert.ok(start >= 0 && end > start, "shared navigator component is present");
  const component = app.slice(start, end);
  assert.match(component, /className="page-back-next-status"/);
  assert.doesNotMatch(component, /timePadOpen|clockNow|page-back-next-time/);
});

test("international time panel remains inside the live weather card", () => {
  const start = app.indexOf("function LiveWeatherPanel");
  const end = app.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start, "live weather component is present");
  const component = app.slice(start, end);
  assert.match(component, /className="live-weather-time-toggle"/);
  assert.match(component, /className="live-weather-time-pad"/);
  assert.match(component, /const\[timePadOpen,setTimePadOpen\]=useState\(false\)/);
});

test("world-time styling does not override the shared portal navigator", () => {
  assert.match(appCss, /\.live-weather-time-toggle/);
  assert.match(appCss, /\.live-weather-time-pad/);
  assert.doesNotMatch(appCss, /page-back-next-time-toggle|page-back-next-time-pad/);
  assert.doesNotMatch(navigationCss, /WORLD TIME \+ PAGE NAVIGATION|page-back-next-time/);
});
