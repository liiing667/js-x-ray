function load() {
  const r = require;
  r("fs");
}

function format(r) {
  r("not-a-dependency");
}

function helper() {
  const r = "a literal string";
  r("also-not-a-dependency");
}
