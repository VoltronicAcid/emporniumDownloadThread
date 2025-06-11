// ==UserScript==
// @name         Empornium - Download Images
// @description  Download all images from a forum thread on Empornium
// @author       VoltronicAcid
// @version      0.3.1
// @namespace    https://github.com/VoltronicAcid/
// @homepageURL  https://github.com/VoltronicAcid/emporniumDownloadThread
// @downloadURL  https://github.com/VoltronicAcid/emporniumDownloadThread/raw/refs/heads/main/downloadThread.user.js
// @match        https://www.empornium.tld/forum/thread/*
// @run-at       document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.download
// @grant        GM.xmlHttpRequest
// @grant        GM.registerMenuCommand
// @grant        GM.unregisterMenuCommand
// @top-level-await
// ==/UserScript==

const BATCH_SIZE = 5;
const BATCH_DELAY_SECONDS = 3;
const FOLDERNAME_LENGTH = 22;
const DOWNLOAD_TIMEOUT_SECONDS = 30;

const setMenu = (() => {
    let title = "";

    return (text, callback = () => { }) => {
        if (title) GM.unregisterMenuCommand(title);

        title = text;
        GM.registerMenuCommand(title, callback);

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

const getFolderName = () => {
    const folderName = document.title
        .match(/.*? >.*? > (.*) ::/)[1]
        .replaceAll(/[^\w\s]/g, "")
        .replaceAll(/[\s]+/g, "_")
        .substring(0, FOLDERNAME_LENGTH);

    return folderName.endsWith("_") ? folderName.slice(0, -1) : folderName;
};

const getPage = async (pageNumber) => {
    const request = { url: document.location.origin + document.location.pathname + `?page=${pageNumber}`, responseType: "document" };
    const { responseXML: page } = await GM.xmlHttpRequest(request);

    return page;
};

const getImagesFromPage = async (pageNumber) => {
    const page = await getPage(pageNumber);
    const folderName = getFolderName();

    const images = Array.from(page.querySelectorAll('.post_content > a[href*="catbox.moe"], .bbcode.scale_image'))
        .map((elem) => {
            const postId = elem.closest(".post_container").id.substring(7);
            const url = elem.tagName === "A" ? elem.href.split("?")[1] : elem.src || elem.dataset.src;
            const fileName = [
                pageNumber,
                postId,
                url.split("/").at(-1),
            ].join("_");
            const name = `${folderName}/${fileName}`;

            return { url, name, pageNumber, postId, downloaded: false, attempts: 0 };
        }).filter(({ url }) => url !== "" && !url.endsWith("/"));

    return images;
};

const downloadImages = async (images) => {
    const promises = images.map((image) => {
        const { url, name } = image;
        const timeout = DOWNLOAD_TIMEOUT_SECONDS * 1000;

        return new Promise((resolve, reject) => {
            const onloadstart = () => {
                image.attempts++
            };
            const onload = () => {
                image.downloaded = true;
                resolve(image);
            };
            const ontimeout = () => {
                image.downloaded = false;
                reject(image);
            };
            const onerror = () => {
                image.downloaded = false;
                reject(image);
            }

            GM.download({ url, name, timeout, ontimeout, onloadstart, onload, onerror });
        });
    }).concat([new Promise((resolve) => setTimeout(() => resolve("Delay"), BATCH_DELAY_SECONDS * 1000))]);   //  delay between downloading batches

    return Promise.allSettled(promises);
};

const downloadThread = async () => {
    const ID = document.location.pathname.split("/").at(-1).split("&")[0];
    const STATE = await GM.getValue(ID, {});

    if (!("images" in STATE)) {
        STATE.title = document.title.match(/.*? >.*? > (.*) ::/)[1];
        STATE.currPage = 1;
        STATE.images = [];
        STATE.failed = [];
    }

    await GM.setValue(ID, STATE);

    const isDownloadEligible = (image) => !image.downloaded && (image.attempts < 3);
    const arrayToChunks = (chunks, image, index) => {
        if (index % BATCH_SIZE === 0) chunks.push([]);

        chunks[chunks.length - 1].push(image);

        return chunks;
    }

    const LEN = getThreadLength();
    while (STATE.currPage <= LEN) {
        setMenu(`Downloading images from page #${STATE.currPage}`);

        if (!STATE.images.length) STATE.images = await getImagesFromPage(STATE.currPage);

        const chunks = STATE.images
            .filter(isDownloadEligible)
            .reduce(arrayToChunks, []);

        for (const chunk of chunks) {
            const results = await downloadImages(chunk);
            const failures = results.filter((res) => res.status === 'rejected').map((res) => res.reason);
            STATE.failed = STATE.failed.concat(failures);
            await GM.setValue(ID, STATE);
        }

        if (STATE.currPage === LEN) break;

        STATE.currPage += 1;
        STATE.images = [];
        await GM.setValue(ID, STATE);
    }

    setMenu("Thread Fully Downloaded");
    return;
};

setMenu("Download Thread", downloadThread);
