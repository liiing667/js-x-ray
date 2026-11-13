const r = require;

function outer() {
  function inner() {
    r("fs");
  }

  return inner;
}
