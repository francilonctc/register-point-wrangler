import { launch } from '@cloudflare/playwright';

const TZ = 'America/Sao_Paulo';

const fmtTimeBR = (d = new Date()) => {
	return new Intl.DateTimeFormat('pt-BR', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(d);
}

const fmtDayBR = (d = new Date()) => new Intl.DateTimeFormat('pt-BR', {timeZone: TZ, day: '2-digit' }).format(d);

const fmtMonthUpperBR = (d = new Date()) => new Intl.DateTimeFormat('pt-BR', {timeZone: TZ, month: 'long' }).format(d).toUpperCase();

const fmtWeekdayUpperBR = (d = new Date()) => {
	const s = new Intl.DateTimeFormat('pt-BR', {timeZone: TZ, weekday: 'long' }).format(d);
	return s.charAt(0).toUpperCase() + s.slice(1).toUpperCase();
}

const isWeekendBR = (d = new Date()) => {
	const day = new Date(d.toLocaleString('en-US', { timeZone: TZ })).getDay();
	return day === 0 || day === 6;
}

const HOLIDAYS = new Set(['17-2-2026', '3-4-2026', '21-4-2026', '1-5-2026', '7-9-2026', '12-10-2026', '2-11-2026', '15-11-2026', '20-11-2026', '25-12-2026',
]);

const isHolidayBR = (d = new Date()) => {
	const br = new Date(d.toLocaleString('en-US', { timeZone: TZ }));
	const dia = br.getDate();
	const mes = br.getMonth() + 1;
	const ano = br.getFullYear();
	return HOLIDAYS.has(`${dia}-${mes}-${ano}`);
}

const buildMessage = (inicio, fim, status) => {
	const titulo = `${fmtMonthUpperBR(inicio)} ${fmtWeekdayUpperBR(inicio)} (${fmtDayBR(inicio)})`;
	return `*${titulo}*\n\*INICIO*: ${fmtTimeBR(inicio)}\n\*FIM*: ${fmtTimeBR(fim)}\n\*STATUS*: ${status}`;
}

const sendTelegram = async (env, text) => {
	const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
	const body = { chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' };

	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if(!res.ok) {
		const err = await res.text();
		console.error('Falha ao enviar Telegram:', err);
	}
} 

const isWithinAllowedWindow = (allowedHours = [], toleranceMinutes = 5) => {
	const now = new Date();
	const hours = now.getHours();
	const minutes = now.getMinutes();
	for (const hour of allowedHours) {
		if (hours === hour && minutes >= 0 && minutes <= toleranceMinutes) {
			return true;
		}
	}
	return false;
}

const clockIn = async (env) => {
	const inicio = new Date();

	try {
		if (!isWithinAllowedWindow([14, 17, 18, 23], 5)) {
			await sendTelegram(env, 'Ponto não registrado: fora do horário permitido.');
			return new Response('skipped');
		}

		if (isWeekendBR(inicio) || isHolidayBR(inicio)) {
			await sendTelegram(env, 'Hoje não é dia útil (fim de semana/feriado. Ponto não necessário).');
			return new Response('skipped');
		}

		if (!env.PMOVEL_USER || !env.PMOVEL_PASS) {
			await sendTelegram(env, 'Variáveis de ambiente PMOVEL_USER ou PMOVEL_PASS não estão definidas.');
			return new Response('missing-credentials', { status: 400 });
		}

		const browser = await launch(env.MYBROWSER);
		const page = await browser.newPage();

		await page.goto('https://app.pmovel.com.br/', { waitUntil: 'networkidle' });
		await page.waitForSelector('#email', { timeout: 20000 });
		
		await page.fill('#email', env.PMOVEL_USER);
		await page.fill('#password', env.PMOVEL_PASS);

		await page.waitForSelector('.btn-primary', { timeout: 20000 });
		
		await Promise.all([
			page.click('.btn-primary'),
			page.waitForLoadState('networkidle', { timeout: 20000 })
		]);
		
		await page.waitForSelector('.btn-success', { timeout: 20000 });
		await page.click('.btn-success');
		
		const fim = new Date();
		await sendTelegram(env, buildMessage(inicio, fim, 'Ponto registrado com sucesso'));

		await browser.close();
		return new Response('success');
	} catch (err) {
		console.error('Erro ao registrar ponto:', err);
		const fim = new Date();
		await sendTelegram(env, buildMessage(inicio, fim, `Erro ao registrar ponto: ${err.message || err}`));
		return new Response('error', { status: 500 });
	}
}

export default {
	async scheduled(event, env, ctx) {
		ctx.waitUntil(clockIn(env));
	},
	
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		if (pathname === '/run') {
			return clockIn(env);
		}
		return new Response('OK');
	}
};