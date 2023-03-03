const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const INFO = {
    account: '账号',
    leftDays: '天数',
    checkInMessage: '签到情况',
    checkInFailded: '签到失败',
    getStatusFailed: '获取信息失败'
};

const checkCOOKIES = (COOKIES) => {
    const cookies = COOKIES?.split('&&') || [];

    if (!cookies.length) {
        console.error('不存在 COOKIES ，请重新检查');
        return false;
    }

    for (const cookie of cookies) {
        if (!cookie.includes('=')) {
            console.error(`存在不正确的 cookie ，请重新检查`);
            return false;
        }

        const pairs = cookie.split(/\s*;\s*/);
        for (const pairStr of pairs) {
            if (!pairStr.includes('=')) {
                console.error(`存在不正确的 cookie ，请重新检查`);
                return false;
            }
        }
    }

    return true;
}

const rawCookie2JSON = (cookie) => {
    return cookie.split(/\s*;\s*/).reduce((pre, current) => {
        const pair = current.split(/\s*=\s*/);
        const name = pair[0];
        const value = pair.splice(1).join('=');
        return [
            ...pre,
            {
                name,
                value,
                'domain': 'glados.rocks'
            }
        ];
    }, []);
};

const checkInAndGetStatus = async (cookie) => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const cookieJSON = rawCookie2JSON(cookie);
    await page.setCookie(...cookieJSON);

    await page.goto('https://glados.rocks/console/checkin', {
        timeout: 0,
        waitUntil: 'load'
    });

    page.on('console', msg => {
        if (console[msg.type()]) {
            console[msg.type()](msg.text());
        } else {
            console.log(msg.text());
        }
    });

    const info = await page.evaluate(async (INFO) => {
        const checkIn = () =>
            fetch('https://glados.rocks/api/user/checkin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json;charset=utf-8',
                },
                body: JSON.stringify({
                    token: "glados.network"
                })
            }).catch(error => {
                console.warn('checkIn 网络错误。');
                return { reason: '网络错误' }
            });

        const getStatus = () => fetch('https://glados.rocks/api/user/status').catch(error => {
            console.warn('getStatus 网络错误。');
            return { reason: '网络错误' }
        });

        let ret = {};

        const checkInRes = await checkIn();
        if (!checkInRes.ok) {
            const reason = checkInRes.reason || `状态码：${checkInRes.status}`;
            console.warn(`checkIn 请求失败，${reason}`);
            ret[INFO.checkInFailded] = reason;
        } else {
            console.info('checkIn 请求成功。');
            const { message } = await checkInRes.json();
            ret[INFO.checkInMessage] = message;
        }

        const statusRes = await getStatus();
        if (!statusRes.ok) {
            const reason = statusRes.reason || `状态码：${statusRes.status}`;
            console.warn(`getStatus 请求失败，${reason}`);
            ret[INFO.getStatusFailed] = reason;
        } else {
            console.info('getStatus 请求成功。');
            const { data: { email, phone, leftDays } = {} } = await statusRes.json();
            let account = '未知账号';
            if (email) {
                account = email.replace(/^(.)(.*)(.@.*)$/,
                    (_, a, b, c) => a + b.replace(/./g, '*') + c
                );
            } else if (phone) {
                account = phone.replace(/^(.)(.*)(.)$/,
                    (_, a, b, c) => a + b.replace(/./g, '*') + c
                );
            }
            ret[INFO.account] = account;
            ret[INFO.leftDays] = parseInt(leftDays);
        }

        return ret;
    }, INFO);

    await browser.close();

    return info;
};

const pushplus = (token, infos) => {
    const data = {
        token,
        title: 'GLaDOS签到',
        content: JSON.stringify(infos),
        template: 'json'
    };
    console.log('pushData', {
        ...data,
        token: data.token.replace(/^(.{1,4})(.*)(.{4,})$/, (_, a, b, c) => a + b.replace(/./g, '*') + c)
    });

    return axios({
        method: 'post',
        url: `http://www.pushplus.plus/send`,
        data
    }).catch((error) => {
        if (error.response) {
            // 请求成功发出且服务器也响应了状态码，但状态代码超出了 2xx 的范围
            console.warn(`PUSHPLUS推送 请求失败，状态码：${error.response.status}`);
        } else if (error.request) {
            // 请求已经成功发起，但没有收到响应
            console.warn('PUSHPLUS推送 网络错误');
        } else {
            // 发送请求时出了点问题
            console.log('Axios Error', error.message);
        }
    });
};

const GLaDOSCheckIn = async () => {
    try {
        if (checkCOOKIES(process.env.COOKIES)) {
            const cookies = process.env.COOKIES.split('&&');

            const infos = await Promise.all(cookies.map(cookie => checkInAndGetStatus(cookie)));
            console.log('infos', infos);

            const PUSHPLUS = process.env.PUSHPLUS;

            if (!PUSHPLUS) {
                console.warn('不存在 PUSHPLUS ，请重新检查');
            }

            if (PUSHPLUS && infos.length) {
                const pushResult = (await pushplus(PUSHPLUS, infos))?.data?.msg;
                console.log('PUSHPLUS pushResult', pushResult);
            }
        }
    } catch (error) {
        console.log(error);
    }
};

GLaDOSCheckIn();