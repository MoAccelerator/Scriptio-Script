// ==UserScript==
// @name         Universal Repeater (New)
// @description  适配于QQ9.9.23.42086+版本的复读机脚本，在消息旁添加「+1」按钮，同时屏蔽 QQ 内置的「+1」按钮。
// @run-at       main, chat
// @reactive     true
// @version      1.1.4
// @homepageURL  https://github.com/MoAccelerator/Scriptio-Script
// @author       accmo
// @license      gpl-3.0
// ==/UserScript==

(function () {
    // 需要调试日志时改成 true，正常使用改回 false
    const debug = false;
    const log = debug ? console.log.bind(console, "[RepeaterFinal]") : () => {};

    let enabled = false;

    function repeat(msgId, contact) {
        if (!window.scriptio || !window.scriptio.invokeNative) {
            console.error("[RepeaterFinal] scriptio.invokeNative 不可用");
            return;
        }
        window.scriptio
            .invokeNative("ntApi", "nodeIKernelMsgService/forwardMsgWithComment", {
                msgIds: [msgId],
                msgAttributeInfos: new Map(),
                srcContact: contact,
                dstContacts: [contact],
                commentElements: []
            }, null)
            .then((res) => {
                log("Forwarded message", res);
            })
            .catch((err) => {
                console.error("[RepeaterFinal] Error forwarding message", err);
            });
    }

    function findMsgRecord(inst, depth = 0) {
        if (!inst || depth > 16) return null;
        const props = inst.props || {};
        const ctx = inst.ctx || inst.proxy || {};
        const candidates = [
            props.msgRecord,
            props.record,
            props.msg,
            props.message,
            ctx.msgRecord,
            ctx.record,
            ctx.msg,
            ctx.message
        ];
        const found = candidates.find(Boolean);
        if (found) {
            debug && log("findMsgRecord 命中", { depth, instUid: inst.uid, found });
            return found;
        }
        return findMsgRecord(inst.parent, depth + 1);
    }

    function attachIconToMessage(messageEl, initialComponent, rootEl) {
        if (!messageEl || !(messageEl instanceof HTMLElement)) return;
        if (!enabled) return;

        const scopeEl = (rootEl instanceof HTMLElement ? rootEl : messageEl);

        const grayTipSelectors = [
            ".gray-tip-message",
            ".gray-tip-element",
            ".gray-tip-content.gray-tip-element",
            ".gray-tip-content.babble"
        ].join(", ");

        const isGrayTip =
            scopeEl.matches?.(grayTipSelectors) ||
            messageEl.matches?.(grayTipSelectors) ||
            scopeEl.querySelector(grayTipSelectors) ||
            messageEl.querySelector(grayTipSelectors);

        if (isGrayTip) {
            debug && log("灰字/系统提示（含撤回提示），跳过", { scopeEl, messageEl });
            scopeEl.querySelectorAll(".universal-repeater").forEach((el) => el.remove());
            messageEl.querySelectorAll(".universal-repeater").forEach((el) => el.remove());
            return;
        }

        if (scopeEl.querySelector(".universal-repeater") || messageEl.querySelector(".universal-repeater")) {
            debug && log("该消息已存在 universal-repeater，跳过", scopeEl);
            return;
        }

        const msgRecord = findMsgRecord(initialComponent);
        if (!msgRecord) {
            debug && log("未找到 msgRecord，初始组件/消息元素为：", initialComponent, scopeEl);
            return;
        }

        try {
            const msgType = msgRecord.msgType;
            const subMsgType = msgRecord.subMsgType;
            const elements = msgRecord.elements || msgRecord.auxiliaryElements || [];
            const firstEl = elements[0] || {};
            const elementType = firstEl.elementType;
            const subElementType = firstEl.subElementType;
            const revokeElement = firstEl.revokeElement;

            const isSystemOrRevoke =
                msgType === 5 ||
                subMsgType === 4 ||
                (elementType === 8 && !!revokeElement) ||
                (!revokeElement &&
                    !firstEl.textElement &&
                    !firstEl.picElement &&
                    !firstEl.replyElement &&
                    elements.length === 0);

            if (isSystemOrRevoke) {
                debug && log("msgRecord 判定为系统/撤回类消息，跳过", {
                    msgType,
                    subMsgType,
                    elementType,
                    subElementType,
                    hasRevokeElement: !!revokeElement
                });
                scopeEl.querySelectorAll(".universal-repeater").forEach((el) => el.remove());
                messageEl.querySelectorAll(".universal-repeater").forEach((el) => el.remove());
                return;
            }
        } catch (e) {
            debug && log("msgRecord 过滤过程中出错，保守起见继续当普通消息处理", e, msgRecord);
        }

        const { peerUid, msgId, chatType } = msgRecord;
        if (!msgId) {
            debug && log("msgRecord 缺少 msgId，跳过", msgRecord);
            return;
        }
        const contact = { chatType, peerUid, guildId: "" };

        const icon = document.createElement("span");
        icon.classList.add("universal-repeater");
        icon.textContent = "+1";
        icon.title = "双击复读";

        let retry = 0;
        function placeIcon() {
            const container =
                messageEl.querySelector(".message-container") ||
                scopeEl.querySelector(".message-container");

            if (container) {
                const bubble =
                    container.querySelector(".message-content__wrapper") ||
                    container.querySelector(".message-content.mix-message__inner") ||
                    container.querySelector(".message-content__inner") ||
                    container.querySelector(".message-content");

                if (bubble) {
                    bubble.insertAdjacentElement("beforeend", icon);
                    debug && log("已为消息挂载 +1（挂在气泡内）", { container, bubble, msgRecord, contact });
                } else {
                    container.insertAdjacentElement("beforeend", icon);
                    debug && log("未找到气泡容器，暂挂在 message-container 内", { container, msgRecord, contact });
                }
                return;
            }

            if (retry < 5) {
                retry += 1;
                requestAnimationFrame(placeIcon);
            } else {
                messageEl.insertAdjacentElement("beforeend", icon);
                debug && log("未找到 message-container，退回挂载到 messageEl", { messageEl, msgRecord, contact });
            }
        }

        placeIcon();

        icon.addEventListener("dblclick", () => {
            repeat(msgId, contact);
        });
    }

    function process(component) {
        if (!enabled) return;

        const rootEl = component?.vnode?.el;
        if (!rootEl) return;

        const vueMessageRoot = rootEl.closest?.(".message.vue-component") || rootEl.closest?.(".message");
        if (!vueMessageRoot) return;

        const innerMessageEl = vueMessageRoot.querySelector(".message") || vueMessageRoot;

        debug && log("vueMount 命中组件", {
            instUid: component.uid,
            rootEl,
            vueMessageRoot,
            messageEl: innerMessageEl,
            props: component.props,
            ctx: component.ctx
        });

        attachIconToMessage(innerMessageEl, component, rootEl);
    }

    function injectStyle() {
        if (document.getElementById("scriptio-universal-repeater-final-style")) return;
        const style = document.createElement("style");
        style.id = "scriptio-universal-repeater-final-style";
        style.textContent = `
        .message {
            position: relative;
        }

        .message .universal-repeater {
            align-self: end;
            color: #87CEEB;
            opacity: 0.8;
            font-size: var(--font_size_1);
            cursor: pointer;
            border-radius: 50%;
            border: 1px solid #87CEEB;
            padding: 0.25em;
            visibility: hidden;
        }

        .message-content__wrapper {
            position: relative;
        }

        .message-content__wrapper .universal-repeater {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
        }

        .message-container:not(.message-container--self):not(.message-container--align-right)
            .message-content__wrapper
            .universal-repeater {
            right: calc(-0.5em - 2.2em);
            left: auto;
        }

        .message-container.message-container--self .message-content__wrapper .universal-repeater,
        .message-container.message-container--align-right .message-content__wrapper .universal-repeater {
            left: calc(-0.5em - 2.2em);
            right: auto;
        }

        .message-container:not(.message-container--self):not(.message-container--align-right)
            .message-content__wrapper::after {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            right: -0.5em;
            width: 0.5em;
        }

        .message-container.message-container--self .message-content__wrapper::after,
        .message-container.message-container--align-right .message-content__wrapper::after {
            content: "";
            position: absolute;
            top: 0;
            bottom: 0;
            left: -0.5em;
            width: 0.5em;
        }

        .message-content__wrapper:hover .universal-repeater,
        .message-content__wrapper .universal-repeater:hover {
            visibility: visible;
        }

        .message-container [class*="plus-one"],
        .message-container [class*="PlusOne"],
        .message-container [class*="msg-react"][class*="plus"],
        .message-container [data-testid="msg-plus-one"],
        .message-container .qqnt-message-plus-one {
            display: none !important;
        }`;
        document.head.appendChild(style);
    }

    function enable() {
        if (enabled) return;

        if (!window.scriptio || !Array.isArray(window.scriptio.vueMount)) {
            console.error("[RepeaterFinal] scriptio.vueMount 不存在，请确认 Scriptio 正常加载");
            return;
        }

        injectStyle();

        if (!window.scriptio.vueMount.includes(process)) {
            window.scriptio.vueMount.push(process);
        }

        enabled = true;
        log("RepeaterFinal enabled");
    }

    function disable() {
        if (!enabled) return;
        enabled = false;

        if (window.scriptio && Array.isArray(window.scriptio.vueMount)) {
            const idx = window.scriptio.vueMount.indexOf(process);
            if (idx > -1) {
                window.scriptio.vueMount.splice(idx, 1);
            }
        }

        document.querySelectorAll(".universal-repeater").forEach((el) => el.remove());

        log("RepeaterFinal disabled");
    }

    function init() {
        if (!window.scriptio) {
            log("Waiting for scriptio...");
            const timer = setInterval(() => {
                if (window.scriptio) {
                    clearInterval(timer);
                    scriptio.listen((v) => {
                        v ? enable() : disable();
                    }, true);
                }
            }, 100);
            setTimeout(() => clearInterval(timer), 10000);
            return;
        }

        scriptio.listen((v) => {
            v ? enable() : disable();
        }, true);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

