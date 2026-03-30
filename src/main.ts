import { App } from "./ui/App";

const mount = document.getElementById("globe-root");
if (!mount) {
  throw new Error('Missing #globe-root — add <div id="globe-root"></div> where the canvas should live.');
}
new App(mount);
