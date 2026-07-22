(function () {
    if (typeof window === 'undefined') return;

    const WASM_JS_URL = window.CAP_WASM_JS_URL || 'application/js/captcha/cap_wasm.min.js';
    const WASM_BIN_URL = window.CAP_WASM_BIN_URL || 'application/js/captcha/cap_wasm_bg.wasm';

    function hashFunc(e, t) {
        let r = (function(e) {
            let t = 0x811c9dc5;
            for (let r = 0; r < e.length; r++) t ^= e.charCodeAt(r), t += (t << 1) + (t << 4) + (t << 7) + (t << 8) + (t << 24);
            return t >>> 0;
        })(e);
        let i = "";
        for (; i.length < t;) i += (r ^= r << 13, r ^= r >>> 17, (r ^= r << 5) >>> 0).toString(16).padStart(8, "0");
        return i.substring(0, t);
    }

    if (!window.CAP_CUSTOM_WASM_URL) {
        [WASM_JS_URL, WASM_BIN_URL].forEach(url => {
            let link = document.createElement("link");
            link.rel = "prefetch";
            link.href = url;
            link.as = url.endsWith(".wasm") ? "fetch" : "script";
            document.head.appendChild(link);
        });
    }

    const customFetch = (...args) => window?.CAP_CUSTOM_FETCH ? window.CAP_CUSTOM_FETCH(...args) : fetch(...args);

    class CapWidget extends HTMLElement {
        #workerBlobUrl = "";
        #expireTimeout = null;
        #workerCount = navigator.hardwareConcurrency || 8;
        token = null;
        #shadowRoot;
        #widgetDiv;
        #self;
        #solving = false;
        #boundEvents;

        getI18nText(key, fallback) {
            return this.getAttribute(`data-cap-i18n-${key}`) || fallback;
        }

        static get observedAttributes() {
            return [
                "onsolve", "onprogress", "onreset", "onerror",
                "data-cap-worker-count", "data-cap-i18n-initial-state", "[cap]",
                "data-cap-direction",
                "data-cap-error",
                "data-cap-background",
                "data-cap-color"
            ];
        }

        constructor() {
            super();
            this.#boundEvents && this.#boundEvents.forEach((fn, ev) => {
                this.removeEventListener(ev.slice(2), fn);
            });
            this.#boundEvents = new Map();
            this.boundHandleProgress = this.handleProgress.bind(this);
            this.boundHandleSolve = this.handleSolve.bind(this);
            this.boundHandleError = this.handleError.bind(this);
            this.boundHandleReset = this.handleReset.bind(this);
        }

        initialize() {
            this.#workerBlobUrl = URL.createObjectURL(new Blob([`(()=>{const e=async({salt:e,target:t})=>{let r=0;const o=new TextEncoder,s=new Uint8Array(t.length/2);for(let e=0;e<s.length;e++)s[e]=parseInt(t.substring(2*e,2*e+2),16);const n=s.length;for(;;)try{for(let t=0;t<5e4;t++){const t=e+r,a=o.encode(t),l=await crypto.subtle.digest("SHA-256",a),c=new Uint8Array(l,0,n);let f=!0;for(let e=0;e<n;e++)if(c[e]!==s[e]){f=!1;break}if(f)return void self.postMessage({nonce:r,found:!0});r++}}catch(e){return console.error("[cap worker]",e),void self.postMessage({found:!1,error:e.message})}};if("object"!=typeof WebAssembly||"function"!=typeof WebAssembly?.instantiate)return console.warn("[cap worker] wasm not supported, falling back to alternative solver. this will be significantly slower."),void(self.onmessage=async({data:{salt:t,target:r}})=>e({salt:t,target:r}));let t,r;self.onmessage=async({data:{salt:o,target:s,wasmUrl:n}})=>{try{if(!n)throw new Error("wasmUrl is empty");if(t!==n){t=n;let u;n.startsWith("http")?u=n:u=new URL(n,self.location.origin).toString();await import(u).then(e=>e.default().then(t=>{r=(t?.exports?t.exports:e).solve_pow}))}const e0=performance.now(),v=r(o,s),e1=performance.now();self.postMessage({nonce:Number(v),found:!0,durationMs:(e1-e0).toFixed(2)})}catch(t){console.error("[cap worker] using fallback solver due to error:",t),e({salt:o,target:s})}};self.onerror=e=>{self.postMessage({found:!1,error:e})}})();`], { type: "application/javascript" }));
        }

        attributeChangedCallback(name, oldVal, newVal) {
            if (name === "data-cap-background") {
                if (newVal) {
                    this.style.setProperty('--cap-background', newVal);
                } else {
                    this.style.removeProperty('--cap-background');
                }
                return;
            }
            if (name === "data-cap-color") {
                if (newVal) {
                    this.style.setProperty('--cap-color', newVal);
                } else {
                    this.style.removeProperty('--cap-color');
                }
                return;
            }

            if (name === "data-cap-error") {
                if (this.#widgetDiv) {
                    if (newVal === "true") {
                        this.#widgetDiv.classList.add("cap-error");
                    } else {
                        this.#widgetDiv.classList.remove("cap-error");
                    }
                }
                return;
            }
            if (name === "data-cap-direction") {
                return;
            }

            if (name.startsWith("on")) {
                let eventName = name.slice(2);
                let oldHandler = this.#boundEvents.get(name);
                if (oldHandler) {
                    this.removeEventListener(eventName, oldHandler);
                }
                if (newVal) {
                    let handler = (e) => {
                        let fnName = this.getAttribute(name);
                        if (typeof window[fnName] === "function") {
                            window[fnName].call(this, e);
                        }
                    };
                    this.#boundEvents.set(name, handler);
                    this.addEventListener(eventName, handler);
                }
            }
            if (name === "data-cap-worker-count") {
                this.setWorkersCount(parseInt(newVal, 10));
            }
            if (name === "data-cap-i18n-initial-state") {
                if (this.#widgetDiv?.querySelector("p")?.innerText) {
                    this.#widgetDiv.querySelector("p").innerText = this.getI18nText("initial-state", "من ربات نیستم!");
                }
            }
        }

        async connectedCallback() {
            this.#self = this;
            this.#shadowRoot = this.attachShadow({ mode: "open" });
            this.#widgetDiv = document.createElement("div");
            this.createUI();
            this.addEventListeners();
            this.initialize();
            this.#widgetDiv.removeAttribute("disabled");

            const bg = this.getAttribute("data-cap-background");
            if (bg) this.style.setProperty('--cap-background', bg);
            const clr = this.getAttribute("data-cap-color");
            if (clr) this.style.setProperty('--cap-color', clr);

            let countAttr = this.getAttribute("data-cap-worker-count");
            let count = countAttr ? parseInt(countAttr, 10) : null;
            this.setWorkersCount(count || navigator.hardwareConcurrency || 8);

            let hiddenFieldName = this.getAttribute("data-cap-hidden-field-name") || "cap-token";
            this.#self.innerHTML = `<input type="hidden" name="${hiddenFieldName}">`;

            if (this.getAttribute("data-cap-error") === "true") {
                this.#widgetDiv.classList.add("cap-error");
            }
        }

        async solve() {
            if (this.#solving) return;
            try {
                this.#solving = true;
                this.updateUI("verifying", this.getI18nText("verifying-label", "Verifying..."), true);
                this.#widgetDiv.setAttribute("aria-label", this.getI18nText("verifying-aria-label", "لطفاً منتظر بمانید"));
                this.dispatchEvent("progress", { progress: 0 });

                try {
                    let endpoint = this.getAttribute("data-cap-api-endpoint");
                    if (!endpoint && window?.CAP_CUSTOM_FETCH) {
                        endpoint = "/";
                    } else if (!endpoint) {
                        throw Error("Missing API endpoint. Either custom fetch or an API endpoint must be provided.");
                    }
                    if (!endpoint.endsWith("/")) endpoint += "/";

                    let { challenge: rawChallenge, token } = await (await customFetch(`${endpoint}challenge`, { method: "POST" })).json();
                    let challenges = rawChallenge;
                    if (!Array.isArray(challenges)) {
                        let idx = 0;
                        challenges = Array.from({ length: rawChallenge.c }, () => (
                            idx += 1,
                                [hashFunc(`${token}${idx}`, rawChallenge.s), hashFunc(`${token}${idx}d`, rawChallenge.d)]
                        ));
                    }

                    let solutions = await this.solveChallenges(challenges);
                    let response = await (await customFetch(`${endpoint}redeem`, {
                        method: "POST",
                        body: JSON.stringify({ token, solutions }),
                        headers: { "Content-Type": "application/json" }
                    })).json();

                    this.dispatchEvent("progress", { progress: 100 });
                    if (!response.success) throw Error("Invalid solution");

                    let hiddenName = this.getAttribute("data-cap-hidden-field-name") || "cap-token";
                    let hiddenInput = this.querySelector(`input[name='${hiddenName}']`);
                    if (hiddenInput) hiddenInput.value = response.token;

                    this.dispatchEvent("solve", { token: response.token });
                    this.token = response.token;

                    if (this.#expireTimeout) clearTimeout(this.#expireTimeout);
                    let expiresIn = new Date(response.expires).getTime() - Date.now();
                    if (expiresIn > 0 && expiresIn < 86400000) {
                        this.#expireTimeout = setTimeout(() => this.reset(), expiresIn);
                    } else {
                        this.error("Invalid expiration time");
                    }

                    this.#widgetDiv.setAttribute("aria-label", this.getI18nText("verified-aria-label", "هویت شما تایید شد، ادامه دهید"));
                    return { success: true, token: this.token };
                } catch (e) {
                    this.#widgetDiv.setAttribute("aria-label", this.getI18nText("error-aria-label", "خطایی رخ داد، لطفاً دوباره تلاش کنید"));
                    this.error(e.message);
                    throw e;
                }
            } finally {
                this.#solving = false;
            }
        }

        async solveChallenges(challenges) {
            let total = challenges.length;
            let solved = 0;
            let workers = Array(this.#workerCount).fill(null).map(() => {
                try {
                    return new Worker(this.#workerBlobUrl);
                } catch (e) {
                    console.error("[cap] Failed to create worker:", e);
                    throw Error("Worker creation failed");
                }
            });

            let solveOne = ([salt, target], index) => new Promise((resolve, reject) => {
                let worker = workers[index];
                if (!worker) return reject(Error("Worker not available"));
                worker.onmessage = ({ data }) => {
                    if (data.found) {
                        solved++;
                        this.dispatchEvent("progress", { progress: Math.round(solved / total * 100) });
                        resolve(data.nonce);
                    }
                };
                worker.onerror = (e) => {
                    this.error(`Error in worker: ${e.message || e}`);
                    reject(e);
                };
                worker.postMessage({
                    salt,
                    target,
                    wasmUrl: window.CAP_CUSTOM_WASM_URL || WASM_JS_URL
                });

                if (typeof WebAssembly !== "object" || typeof WebAssembly?.instantiate !== "function") {
                    if (!this.#shadowRoot.querySelector(".warning")) {
                        let warning = document.createElement("div");
                        warning.className = "warning";
                        warning.style.cssText = "width: var(--cap-widget-width, 250px);background: rgb(237, 56, 46);color: white;padding: 4px 6px;padding-bottom: calc(var(--cap-border-radius, 14px) + 5px);font-size: 10px;box-sizing: border-box;font-family: system-ui;border-top-left-radius: 8px;border-top-right-radius: 8px;text-align: center;padding-bottom:calc(var(--cap-border-radius,14px) + 5px);user-select:none;margin-bottom: -35.5px;opacity: 0;transition: margin-bottom .3s,opacity .3s;";
                        warning.innerText = this.getI18nText("wasm-disabled", "Enable WASM for significantly faster solving");
                        this.#shadowRoot.insertBefore(warning, this.#shadowRoot.firstChild);
                        setTimeout(() => {
                            warning.style.marginBottom = "calc(-1 * var(--cap-border-radius, 14px))";
                            warning.style.opacity = 1;
                        }, 10);
                    }
                }
            });

            let results = [];
            try {
                for (let i = 0; i < challenges.length; i += this.#workerCount) {
                    let batch = challenges.slice(i, Math.min(i + this.#workerCount, challenges.length));
                    let batchResults = await Promise.all(batch.map((ch, idx) => solveOne(ch, idx)));
                    results.push(...batchResults);
                }
            } finally {
                workers.forEach(w => {
                    if (w) {
                        try { w.terminate(); } catch (e) { console.error("[cap] error terminating worker:", e); }
                    }
                });
            }
            return results;
        }

        setWorkersCount(count) {
            let parsed = parseInt(count, 10);
            let max = Math.min(navigator.hardwareConcurrency || 8, 16);
            this.#workerCount = !Number.isNaN(parsed) && parsed > 0 && parsed <= max ? parsed : navigator.hardwareConcurrency || 8;
        }

        createUI() {
            this.#widgetDiv.classList.add("captcha");
            this.#widgetDiv.setAttribute("role", "button");
            this.#widgetDiv.setAttribute("tabindex", "0");
            this.#widgetDiv.setAttribute("aria-label", this.getI18nText("verify-aria-label", "Click to verify you're a human"));
            this.#widgetDiv.setAttribute("aria-live", "polite");
            this.#widgetDiv.setAttribute("disabled", "true");
            this.#widgetDiv.innerHTML = `
        <div class="checkbox" part="checkbox">
          <svg class="progress-ring" viewBox="0 0 32 32">
            <circle class="progress-ring-bg" cx="16" cy="16" r="14"></circle>
            <circle class="progress-ring-circle" cx="16" cy="16" r="14"></circle>
          </svg>
        </div>
        <p part="label">${this.getI18nText("initial-state", "من ربات نیستم!")}</p>
        <a part="attribution" aria-label="Secured by FusionCMS" href="https://github.com/FusionWowCMS/FusionCMS" class="credits" target="_blank" rel="follow noopener">FusionCMS</a>
      `;
            this.#shadowRoot.innerHTML = `<style${window.CAP_CSS_NONCE ? ` nonce=${window.CAP_CSS_NONCE}` : ""}>
        .captcha,.captcha * {box-sizing:border-box;direction: rtl;}
        .captcha{background-color:var(--cap-background,#fdfdfd);border:1px solid var(--cap-border-color,#dddddd8f);border-radius:var(--cap-border-radius,14px);user-select:none;height:var(--cap-widget-height, 58px);width:var(--cap-widget-width, 250px);display:flex;align-items:center;padding:var(--cap-widget-padding,14px);gap:var(--cap-gap,15px);cursor:pointer;transition:filter .2s,transform .2s;position:relative;-webkit-tap-highlight-color:rgba(255,255,255,0);overflow:hidden;color:var(--cap-color,#212121)}
        .captcha:hover{filter:brightness(98%)}
        .checkbox{width:var(--cap-checkbox-size,25px);height:var(--cap-checkbox-size,25px);border:var(--cap-checkbox-border,1px solid #aaaaaad1);border-radius:var(--cap-checkbox-border-radius,6px);background-color:var(--cap-checkbox-background,#fafafa91);transition:opacity .2s;margin-top:var(--cap-checkbox-margin,2px);margin-bottom:var(--cap-checkbox-margin,2px)}
        .captcha *{font-family:var(--cap-font,system,-apple-system,"BlinkMacSystemFont",".SFNSText-Regular","San Francisco","Roboto","Segoe UI","Helvetica Neue","Lucida Grande","Ubuntu","arial",sans-serif)}
        .captcha p{margin:0;font-weight:500;font-size:15px;user-select:none;transition:opacity .2s}
        .checkbox .progress-ring{display:none;width:100%;height:100%;transform:rotate(-90deg)}
        .checkbox .progress-ring-bg{fill:none;stroke:var(--cap-spinner-background-color,#eee);stroke-width:var(--cap-spinner-thickness,3)}
        .checkbox .progress-ring-circle{fill:none;stroke:var(--cap-spinner-color,#000);stroke-width:var(--cap-spinner-thickness,3);stroke-linecap:round;stroke-dasharray:87.96;stroke-dashoffset:87.96;transition:stroke-dashoffset 0.3s ease}
        .captcha[data-state=verifying] .checkbox{background:none;display:flex;align-items:center;justify-content:center;transform:scale(1.1);border:none;border-radius:50%;background-color:transparent}
        .captcha[data-state=verifying] .checkbox .progress-ring{display:block}
        .captcha[data-state=done] .checkbox{border:1px solid transparent;background-image:var(--cap-checkmark,url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%3E%3Cstyle%3E%40keyframes%20anim%7B0%25%7Bstroke-dashoffset%3A23.21320343017578px%7Dto%7Bstroke-dashoffset%3A0%7D%7D%3C%2Fstyle%3E%3Cpath%20fill%3D%22none%22%20stroke%3D%22%2300a67d%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%222%22%20d%3D%22m5%2012%205%205L20%207%22%20style%3D%22stroke-dashoffset%3A0%3Bstroke-dasharray%3A23.21320343017578px%3Banimation%3Aanim%20.5s%20ease%22%2F%3E%3C%2Fsvg%3E"));background-size:cover}
        .captcha[data-state=done] .checkbox .progress-ring{display:none}
        .captcha[data-state=error] .checkbox{border:1px solid transparent;background-image:var(--cap-error-cross,url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 24 24'%3E%3Cpath fill='%23f55b50' d='M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.47 2 2 6.5 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10A10 10 0 0 0 12 2m0 18a8 8 0 0 1-8-8a8 8 0 0 1 8-8a8 8 0 0 1 8 8a8 8 0 0 1-8 8'/%3E%3C/svg%3E"));background-size:cover}
        .captcha[data-state=error] .checkbox .progress-ring{display:none}
        .captcha[disabled]{cursor:not-allowed}
        .captcha[disabled][data-state=verifying]{cursor:progress}
        .captcha[disabled][data-state=done]{cursor:default}
        .captcha .credits{position:absolute;bottom:10px;left:10px;font-size:12px;color:var(--cap-color,#212121);opacity:0.8;text-underline-offset: 1.5px;}

        :host([data-cap-direction="ltr"]) .captcha,
        :host([data-cap-direction="ltr"]) .captcha * {
            direction: ltr !important;
        }
        :host([data-cap-direction="ltr"]) .captcha .credits {
            left: auto;
            right: 10px;
        }

        .captcha.cap-error {
            border-color: #ff0000 !important;
        }
      </style>`;
            this.#shadowRoot.appendChild(this.#widgetDiv);
        }

        addEventListeners() {
            if (!this.#widgetDiv) return;
            this.#widgetDiv.querySelector("a").addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                window.open("https://github.com/FusionWowCMS/FusionCMS", "_blank", "noopener,noreferrer");
            });
            this.#widgetDiv.addEventListener("click", () => {
                if (!this.#widgetDiv.hasAttribute("disabled")) this.solve();
            });
            this.#widgetDiv.addEventListener("keydown", (e) => {
                if ((e.key === "Enter" || e.key === " ") && !this.#widgetDiv.hasAttribute("disabled")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.solve();
                }
            });
            this.addEventListener("progress", this.boundHandleProgress);
            this.addEventListener("solve", this.boundHandleSolve);
            this.addEventListener("error", this.boundHandleError);
            this.addEventListener("reset", this.boundHandleReset);
        }

        updateUI(state, text, disabled = false) {
            if (!this.#widgetDiv) return;
            this.#widgetDiv.setAttribute("data-state", state);
            this.#widgetDiv.querySelector("p").innerText = text;
            if (disabled) {
                this.#widgetDiv.setAttribute("disabled", "true");
            } else {
                this.#widgetDiv.removeAttribute("disabled");
            }
        }

        handleProgress(e) {
            if (!this.#widgetDiv) return;
            let p = this.#widgetDiv.querySelector("p");
            let circle = this.#widgetDiv.querySelector(".progress-ring-circle");
            if (p && circle) {
                let circumference = 2 * Math.PI * 14;
                let offset = circumference - (e.detail.progress / 100) * circumference;
                circle.style.strokeDashoffset = offset;
                p.innerText = `${this.getI18nText("verifying-label", "در حال بررسی...")} ${e.detail.progress}%`;
            }
            this.executeAttributeCode("onprogress", e);
        }

        handleSolve(e) {
            this.updateUI("done", this.getI18nText("solved-label", "تایید شد!"), true);
            this.executeAttributeCode("onsolve", e);
        }

        handleError(e) {
            this.updateUI("error", this.getI18nText("error-label", "Error. Try again."));
            this.executeAttributeCode("onerror", e);
        }

        handleReset(e) {
            this.updateUI("", this.getI18nText("initial-state", "من ربات نیستم!"));
            this.executeAttributeCode("onreset", e);
        }

        executeAttributeCode(attr, event) {
            let code = this.getAttribute(attr);
            if (code) {
                Function("event", code).call(this, event);
            }
        }

        error(msg = "Unknown error") {
            console.error("[cap]", msg);
            this.dispatchEvent("error", { isCap: true, message: msg });
        }

        dispatchEvent(type, detail = {}) {
            let event = new CustomEvent(type, { bubbles: true, composed: true, detail });
            super.dispatchEvent(event);
        }

        reset() {
            if (this.#expireTimeout) {
                clearTimeout(this.#expireTimeout);
                this.#expireTimeout = null;
            }
            this.dispatchEvent("reset");
            this.token = null;
            let hiddenName = this.getAttribute("data-cap-hidden-field-name") || "cap-token";
            let hiddenInput = this.querySelector(`input[name='${hiddenName}']`);
            if (hiddenInput) hiddenInput.value = "";
        }

        get tokenValue() {
            return this.token;
        }

        disconnectedCallback() {
            this.removeEventListener("progress", this.boundHandleProgress);
            this.removeEventListener("solve", this.boundHandleSolve);
            this.removeEventListener("error", this.boundHandleError);
            this.removeEventListener("reset", this.boundHandleReset);
            this.#boundEvents.forEach((fn, ev) => {
                this.removeEventListener(ev.slice(2), fn);
            });
            this.#boundEvents.clear();
            if (this.#shadowRoot) this.#shadowRoot.innerHTML = "";
            this.reset();
            this.cleanup();
        }

        cleanup() {
            if (this.#expireTimeout) {
                clearTimeout(this.#expireTimeout);
                this.#expireTimeout = null;
            }
            if (this.#workerBlobUrl) {
                URL.revokeObjectURL(this.#workerBlobUrl);
                this.#workerBlobUrl = "";
            }
        }
    }

    class Cap {
        constructor(options = {}, existingElement) {
            let widget = existingElement || document.createElement("cap-widget");
            Object.entries(options).forEach(([key, value]) => {
                widget.setAttribute(key, value);
            });
            if (!options.apiEndpoint && !window?.CAP_CUSTOM_FETCH) {
                widget.remove();
                throw new Error("Missing API endpoint. Either custom fetch or an API endpoint must be provided.");
            }
            if (options.apiEndpoint) widget.setAttribute("data-cap-api-endpoint", options.apiEndpoint);
            this.widget = widget;
            this.solve = this.widget.solve.bind(this.widget);
            this.reset = this.widget.reset.bind(this.widget);
            this.addEventListener = this.widget.addEventListener.bind(this.widget);
            Object.defineProperty(this, "token", {
                get: () => widget.token,
                configurable: true,
                enumerable: true
            });
            if (!existingElement) {
                widget.style.display = "none";
                document.documentElement.appendChild(widget);
            }
        }
    }

    window.Cap = Cap;

    if (!customElements.get("cap-widget") || window?.CAP_DONT_SKIP_REDEFINE) {
        if (customElements.get("cap-widget")) {
            console.warn("[cap] the cap-widget element has already been defined, redefining because CAP_DONT_SKIP_REDEFINE is true.");
        }
        customElements.define("cap-widget", CapWidget);
    } else {
        console.warn("[cap] the cap-widget element has already been defined, skipping re-defining it. To prevent this, set window.CAP_DONT_SKIP_REDEFINE to true");
    }

    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = Cap;
    } else if (typeof define === 'function' && define.amd) {
        define([], () => Cap);
    }
    if (typeof exports !== 'undefined') {
        exports.default = Cap;
    }
})();