// ==UserScript==
// @name         Download Images
// @description  Download all images from a forum thread on Empornium
// @author       VoltronicAcid
// @version      0.1
// @namespace    https://github.com/VoltronicAcid/
// @homepageURL  https://github.com/VoltronicAcid/emporniumDownloadThread
// @downloadURL  https://github.com/VoltronicAcid/emporniumDownloadThread/raw/refs/heads/main/downloadThread.user.js
// @match        https://www.empornium.tld/forum/thread/*
// run-at        document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.download
// @grant        GM.xmlHttpRequest
// @grant        GM.registerMenuCommand
// @grant        GM.unregisterMenuCommand
// @top-level-await
// ==/UserScript==

const ID = document.location.pathname.split("/").at(-1).split("&")[0];
const STATE = await GM.getValue(ID, {});

const updateMenu = (() => {
    const titles = ["Download Thread", "Downloading Images...", "Downloading Complete"];
    let idx = 0;
    const noOp = () => { };

    return (callback) => {
        if (idx) GM.unregisterMenuCommand(titles[idx - 1]);
        GM.registerMenuCommand(titles[idx++], callback || noOp);

        return;
    };
})();

const getThreadLength = () => {
    const regex = /page=(\d+)/;
    const pager = document.querySelector("div.linkbox.pager");
    const pageLinks = pager.querySelectorAll("a.pager.pager_page");
    const lastPager = pager.querySelector("a.pager.pager_last");

    if (pageLinks.length === 0) return 1;

    if (lastPager) return parseInt(lastPager.href.match(regex)[1], 10);

    return parseInt(pageLinks[pageLinks.length - 1].href.match(regex)[1], 10) + 1;
};

const getPage = async (pageNumber) => {
    const request = { url: document.location.origin + document.location.pathname + `?page=${pageNumber}`, responseType: "document" };
    const { responseXML: page } = await GM.xmlHttpRequest(request);

    return page;
};

const getImages = async (pageNumber) => {
    const page = await getPage(pageNumber);

    const images = Array.from(page.querySelectorAll('a[href*="catbox.moe"], .bbcode.scale_image'))
        .map((elem) => {
            const postId = elem.closest(".post_container").id.substring(7);
            const url = elem.tagName === "A" ? elem.href.split("?")[1] : elem.src || elem.dataset.src;
            const filename = url.split("/").at(-1);
            const name = [
                STATE.title.replaceAll(/[^\w\s]/g, "").replaceAll(/[\s]+/g, "_").substring(0, 21),
                pageNumber,
                postId,
                filename,
            ].join("_").replaceAll(/_{2,}/g, "_");

            return { url, name, pageNumber, postId, downloaded: false, attempts: 0 };
        }).filter(({ url }) => url !== "" && !url.endsWith("/"));

    return images;
};

const downloadImages = async (images) => {
    const promises = images.map((image) => {
        const context = image;
        const { url, name } = image;
        const timeout = 30 * 1000;

        return new Promise((resolve, reject) => {
            const onloadstart = (resp) => {
                resp.context.attempts++
            };
            const onload = (resp) => {
                resp.context.downloaded = true;
                resolve(resp);
            };
            const ontimeout = (resp) => {
                resp.context.downloaded = false;
                reject(resp);
            };
            const onerror = (resp) => {
                resp.context.downloaded = false;
                reject(resp);
            }

            GM.download({ url, name, context, timeout, ontimeout, onloadstart, onload, onerror })
        });
    }).concat([new Promise(resolve => setTimeout(resolve("Delay"), 5 * 1000))]);   //  delay between downloading groups

    return await Promise.allSettled(promises);
};

const buildState = async () => {
    if (!("pages" in STATE)) {
        STATE.title = document.title.match(/.*? >.*? > (.*) ::/)[1];
        STATE.pages = JSON.parse(sessionStorage.getItem(ID))?.pages || [];
    }

    const threadLength = getThreadLength();
    for (let pageNumber = STATE.pages.length || 1; pageNumber <= threadLength; pageNumber += 1) {
        const idx = pageNumber - 1;

        while (pageNumber > STATE.pages.length) {
            STATE.pages.push([]);
        }

        STATE.pages[idx] = STATE.pages[idx].concat((await getImages(pageNumber)).slice(STATE.pages[idx].length));

        if ((await GM.getValue(ID, false))) {
            await GM.setValue(ID, STATE);
            await new Promise((resolve) => setTimeout(() => resolve(), 1500));
        } else {
            sessionStorage.setItem(ID, JSON.stringify(STATE));
        }
    }
};

const downloadThread = async () => {
    updateMenu();
    await GM.setValue(ID, STATE);

    const downloadCriteria = (image) => !image.downloaded && (image.attempts < 3);
    const chunkArr = (chunks, image, index, _, chunkLength = 3) => {
        if (index % chunkLength === 0) chunks.push([]);

        chunks[chunks.length - 1].push(image);

        return chunks;
    }

    for (let idx = 0; idx < STATE.pages.length; idx += 1) {
        if (!STATE.pages[idx].length) continue;

        const chunks = STATE.pages[idx].filter(downloadCriteria).reduce(chunkArr, []);
        for (const chunk of chunks) {
            await downloadImages(chunk);
        }

        STATE.pages[idx] = idx < STATE.pages.length - 1 ? STATE.pages[idx].filter(downloadCriteria) : STATE.pages[idx];
        await GM.setValue(ID, STATE);
    }

    updateMenu();
    return;
};

const main = async () => {
    updateMenu(downloadThread);

    Array.from(document.getElementsByClassName(`subscribelink${ID}`)).forEach((link) => {
        link.addEventListener("click", async ({ target: { textContent } }) => {
            if (textContent === "Subscribe") {
                await GM.setValue(ID, STATE);
            }
        });
    });

    await buildState();
};

await main();
