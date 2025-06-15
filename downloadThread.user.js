// ==UserScript==
// @name         Empornium - Download Images
// @description  Download all images from a forum thread on Empornium
// @author       VoltronicAcid
// @version      0.3.2
// @namespace    https://github.com/VoltronicAcid/
// @homepageURL  https://github.com/VoltronicAcid/emporniumDownloadThread
// @downloadURL  https://github.com/VoltronicAcid/emporniumDownloadThread/raw/refs/heads/main/downloadThread.user.js
// @match        https://www.empornium.is/forum/thread/*
// @run-at       document-idle
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.download
// @grant        GM.xmlHttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

const BATCH_SIZE = 3;
const BATCH_DELAY_SECONDS = 2;
const FOLDERNAME_LENGTH = 22;
const DOWNLOAD_TIMEOUT = 30;
const MAX_RETRY_ATTEMPTS = 5;

const setMenu = (() => {
    let id;

    return (title, callback = () => { }) => {
        if (id) GM_unregisterMenuCommand(id);

        id = GM_registerMenuCommand(title, callback);

        return;
    };
})();

const getState = async (threadId) => {
    const state = await GM.getValue(threadId, {});

    if (!Object.keys(state).length) {
        state.title = document.title.match(/.*? >.*? > (.*) ::/)[1];
        state.currPage = 1;
        state.failed = [];
        state.images = [];

        await GM.setValue(threadId, state);
    }

    return state;
};

const getThreadLength = () => {
    const pagerLinks = Array.from(document.querySelectorAll("a.pager"))
    if (!pagerLinks.length) return 1;

    const lastLink = pagerLinks.at(-1);
    const pageNum = parseInt(lastLink.href.match(/page=(\d+)/)[1], 10);

    return lastLink.classList.contains("pager_last")
        ? pageNum
        : pageNum + 1;
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
        const timeout = DOWNLOAD_TIMEOUT * 1000;

        return new Promise((resolve, reject) => {
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

            image.attempts++;
            GM.download({ url, name, timeout, ontimeout, onload, onerror });
        });
    }).concat([new Promise((resolve) => setTimeout(() => resolve("Delay"), BATCH_DELAY_SECONDS * 1000))]);   //  delay between downloading batches

    return Promise.allSettled(promises);
};

const downloadCriteria = (image) => !image.downloaded && (image.attempts < MAX_RETRY_ATTEMPTS);

const getImageBatches = (images, batchSize) => {
    return images
        .filter(downloadCriteria)
        .reduce((batches, image, idx) => {
            if (idx % batchSize === 0) batches.push([]);

            batches[batches.length - 1].push(image);

            return batches;
        }, []);
};

const retryFailures = async (threadId, state) => {
    // Remove images from failed that will be downloaded in the normal flow
    const currImageUrls = new Set(state.images.filter((image) => !image.downloaded).map((image) => image.url));
    state.failed = state.failed.filter((image) => !currImageUrls.has(image.url));

    const downloadBatches = getImageBatches(state.failed, BATCH_SIZE);

    for (const imageBatch of downloadBatches) {
        await downloadImages(imageBatch);
        await GM.setValue(threadId, state);
    }

    state.failed = state.failed.filter(downloadCriteria);
    await GM.setValue(threadId, state);

    return;
};

const downloadThread = async () => {
    const threadId = document.location.pathname.split("/").at(-1).split("&")[0];
    const state = await getState(threadId);

    if (state.failed.length) await retryFailures(threadId, state);

    const threadLength = getThreadLength();
    while (state.currPage <= threadLength) {
        setMenu(`Downloading images from page #${state.currPage}`);

        const images = await getImagesFromPage(state.currPage);
        state.images = state.images.concat(images.slice(state.images.length));
        await GM.setValue(threadId, state);

        const downloadBatches = getImageBatches(state.images, BATCH_SIZE);

        for (const imageBatch of downloadBatches) {
            const results = await downloadImages(imageBatch);
            const failures = results.filter((res) => res.status === 'rejected').map((res) => res.reason);
            state.failed = state.failed.concat(failures);
            await GM.setValue(threadId, state);
        }

        if (state.currPage === threadLength) break;

        state.currPage += 1;
        state.images = [];
        await GM.setValue(threadId, state);
    }

    setMenu("Thread Fully Downloaded");

    return;
};

setMenu("Download Thread", downloadThread);
