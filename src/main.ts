import "./style.css";

fetch("/api/hello")
  .then((res) => res.text())
  .then((res) => (document.querySelector("#app")!.innerHTML = `<h1>${res}</h1>`));
