const r = require;

function load() {
  {
    const r = "local";
    r("not-a-dependency");
  }
  r("fs");
}
