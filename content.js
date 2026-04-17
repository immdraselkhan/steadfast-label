(function () {
  const BTN_ID = "sf-get-label-btn";

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getParcelId() {
    const m = location.pathname.match(/print-label\/(\d+)/);
    return m ? m[1] : "label";
  }

  function sanitizeFileName(name) {
    return (name || "label")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function addButton() {
    if (document.getElementById(BTN_ID)) return;

    const actions = document.querySelector(".screen-actions");
    if (!actions) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.textContent = "Get Label";
    btn.className = "btn-print";
    btn.style.background = "#19b394";
    btn.style.borderColor = "#19b394";
    btn.style.color = "#fff";

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Loading...";

      try {
        const consignmentData = await fetchConsignmentData();
        const defaultName = consignmentData.itemDescription || "";

        const productName = prompt("Enter product name:", defaultName);
        if (!productName || !productName.trim()) return;

        btn.textContent = "Processing...";
        await processLabel(
          productName.trim(),
          consignmentData.fullAddress || "",
        );
      } catch (err) {
        console.error("Steadfast label error:", err);
        alert("Failed to generate label image.\n\n" + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Get Label";
      }
    });

    actions.appendChild(btn);
  }

  async function fetchConsignmentData() {
    const id = getParcelId();
    const detailsUrl = `https://steadfast.com.bd/user/consignment/${id}`;

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "fetch-consignment-details", url: detailsUrl },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(res);
        },
      );
    });

    if (!response || !response.success || !response.html) {
      throw new Error(response?.error || "Failed to fetch consignment details");
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(response.html, "text/html");

    let fullAddress = "";
    let itemDescription = "";

    const clientInfo = doc.querySelector(".client-info");
    if (clientInfo) {
      const ps = clientInfo.querySelectorAll("p");
      for (const p of ps) {
        const small = p.querySelector("small");
        const span = p.querySelector("span");
        if (!small || !span) continue;

        const label = small.textContent
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const value = span.textContent.replace(/\s+/g, " ").trim();

        if (label.startsWith("address")) {
          fullAddress = value;
        }
      }
    }

    const senderInfo = doc.querySelector(".sender-info");
    if (senderInfo) {
      const titleNodes = senderInfo.querySelectorAll(".title p");
      let foundItemTitle = false;

      for (const titleNode of titleNodes) {
        const titleText = titleNode.textContent
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (titleText === "item descriptions") {
          foundItemTitle = true;
          const titleWrap = titleNode.closest(".title");
          if (titleWrap) {
            let next = titleWrap.nextElementSibling;
            if (next) {
              const p = next.querySelector("p");
              if (p) {
                itemDescription = p.textContent.replace(/\s+/g, " ").trim();
              }
            }
          }
          break;
        }
      }

      if (!foundItemTitle && !itemDescription) {
        const firstP = senderInfo.querySelector(".d-flex.gap-1.flex-column p");
        if (firstP) {
          itemDescription = firstP.textContent.replace(/\s+/g, " ").trim();
        }
      }
    }

    return { fullAddress, itemDescription };
  }

  async function processLabel(productName, fullAddress) {
    const label = document.querySelector("#label-box");
    if (!label) throw new Error("Label not found");

    const cleanup = [];

    const setStyle = (el, styles) => {
      if (!el) return;
      const oldStyles = {};
      Object.keys(styles).forEach((key) => {
        oldStyles[key] = el.style[key];
      });
      cleanup.push(() => {
        Object.keys(oldStyles).forEach((key) => {
          el.style[key] = oldStyles[key];
        });
      });
      Object.assign(el.style, styles);
    };

    const replaceOuterHTML = (el, html) => {
      if (!el || !el.parentNode) return;

      const parent = el.parentNode;
      const marker = document.createComment("sf-marker");
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const newEl = wrapper.firstElementChild;
      const oldEl = el;

      cleanup.push(() => {
        if (!marker.parentNode) return;
        if (newEl && newEl.parentNode) newEl.remove();
        marker.parentNode.insertBefore(oldEl, marker);
        marker.remove();
      });

      parent.insertBefore(marker, el);
      el.remove();
      marker.parentNode.insertBefore(newEl, marker);
    };

    setStyle(label, {
      height: "auto",
    });

    const cod = label.querySelector(".lbl-cod");
    if (cod) {
      replaceOuterHTML(
        cod,
        `<div class="lbl-cod">
          <span class="cod-label" style="margin:auto;">${escapeHtml(productName)}</span>
        </div>`,
      );
    }

    if (fullAddress) {
      const addressValue = Array.from(
        label.querySelectorAll(".lbl-customer .c-row"),
      ).find((row) => {
        const k = row.querySelector(".ck");
        return k && k.textContent.trim().toLowerCase() === "address";
      });

      if (addressValue) {
        const cv = addressValue.querySelector(".cv");
        if (cv) {
          const oldText = cv.textContent;
          const oldLineHeight = cv.style.lineHeight;
          const oldWordBreak = cv.style.wordBreak;

          cleanup.push(() => {
            cv.textContent = oldText;
            cv.style.lineHeight = oldLineHeight;
            cv.style.wordBreak = oldWordBreak;
          });

          cv.textContent = fullAddress;
          cv.style.lineHeight = "14px";
          cv.style.wordBreak = "break-word";
        }
      }
    }

    await wait(150);

    const activeLabel = document.querySelector("#label-box");
    if (!activeLabel) throw new Error("Updated label not found");

    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "#ffffff",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      overflow: "auto",
      padding: "40px",
    });

    const clone = activeLabel.cloneNode(true);
    Object.assign(clone.style, {
      margin: "0",
      transform: "scale(3)",
      transformOrigin: "top center",
      boxShadow: "none",
      height: "auto",
    });

    overlay.appendChild(clone);
    document.body.appendChild(overlay);

    cleanup.push(() => {
      if (overlay.parentNode) overlay.remove();
    });

    await wait(500);

    const rect = clone.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (!rect.width || !rect.height) {
      throw new Error("Preview label size is invalid");
    }

    const dataUrl = await captureTabImage();
    const img = await loadImage(dataUrl);

    const padding = 0;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(
      img,
      Math.round(rect.left * dpr),
      Math.round(rect.top * dpr),
      Math.round(rect.width * dpr),
      Math.round(rect.height * dpr),
      0,
      0,
      Math.round(rect.width * dpr),
      Math.round(rect.height * dpr),
    );

    const output = canvas.toDataURL("image/png");
    if (!output) throw new Error("Canvas export failed");

    cleanup.reverse().forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });

    showPreview(output);
  }

  function captureTabImage() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "capture-tab" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("sendMessage: " + chrome.runtime.lastError.message));
          return;
        }

        if (!response) {
          reject(new Error("No response from background"));
          return;
        }

        if (!response.success) {
          reject(new Error(response.error || "Capture failed"));
          return;
        }

        resolve(response.dataUrl);
      });
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Captured image load failed"));
      img.src = src;
    });
  }

  function showPreview(dataUrl) {
    const old = document.getElementById("sf-preview-overlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "sf-preview-overlay";

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.7)",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: "12px",
      padding: "20px",
      boxSizing: "border-box",
    });

    const viewer = document.createElement("div");
    Object.assign(viewer.style, {
      background: "#fff",
      borderRadius: "6px",
      overflow: "auto",
      boxSizing: "border-box",
      padding: "10px",
    });

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Generated label preview";
    img.draggable = false;

    Object.assign(img.style, {
      display: "block",
      width: "auto",
      height: "auto",
      maxWidth: "none",
      maxHeight: "none",
      background: "#fff",
      userSelect: "auto",
      WebkitUserSelect: "auto",
      cursor: "default",
    });

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, {
      display: "flex",
      gap: "10px",
    });

    const copyBtn = document.createElement("button");
    copyBtn.innerText = "Copy Image";
    Object.assign(copyBtn.style, {
      padding: "8px 14px",
      border: "none",
      background: "#19b394",
      color: "#fff",
      borderRadius: "4px",
      cursor: "pointer",
    });

    copyBtn.onclick = async () => {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          copyBtn.innerText = "Copy Image";
        }, 1200);
      } catch (e) {
        alert(
          "Clipboard copy failed. You can also right-click the image and copy it.",
        );
      }
    };

    const closeBtn = document.createElement("button");
    closeBtn.innerText = "Close";
    Object.assign(closeBtn.style, {
      padding: "8px 14px",
      border: "none",
      background: "#dc3545",
      color: "#fff",
      borderRadius: "4px",
      cursor: "pointer",
    });

    closeBtn.onclick = () => overlay.remove();

    viewer.appendChild(img);
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    overlay.appendChild(viewer);
    overlay.appendChild(btnRow);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  function init() {
    addButton();

    const observer = new MutationObserver(() => {
      addButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  init();
})();
