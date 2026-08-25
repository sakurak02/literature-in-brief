(() => {
  const recordBody = document.querySelector(".record-body");
  const readingRecord = recordBody?.closest(".reading-record");
  const readingShell = readingRecord?.closest(".reading-shell");

  if (!recordBody || !readingRecord || !recordBody.querySelector(".reading-page")) {
    return;
  }

  const modes = [
    ["parallel", "対訳"],
    ["source", "英訳"],
    ["translation", "和訳"],
  ];
  const tabs = document.createElement("div");
  tabs.className = "reading-tabs";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "読書記録の表示切替");

  const setMode = (mode) => {
    readingRecord.dataset.readingMode = mode;
    for (const button of tabs.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.readingMode === mode));
    }
  };

  for (const [mode, label] of modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reading-tabs__button";
    button.dataset.readingMode = mode;
    button.textContent = label;
    button.addEventListener("click", () => setMode(mode));
    tabs.append(button);
  }

  readingRecord.classList.add("reading-record--enhanced");
  readingShell?.classList.add("reading-shell--enhanced");
  recordBody.before(tabs);
  setMode("parallel");
})();
