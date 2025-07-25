import { defineComponent, markRaw, ref } from 'vue';
import interfacesJson from '../api.json';
import ApiParameter from './ApiParameter.vue';
import HighlightedSearchMethod from './HighlightedSearchMethod';
import type { ApiInterface, ApiMethod, ApiMethodParameter, ApiServices, SidebarGroupData } from './interfaces';
import { ApiSearcher } from './search';

const sidebar = ref<HTMLElement | null>(null);
const inputSearch = ref<HTMLInputElement | null>(null);
const inputApiKey = ref<HTMLInputElement | null>(null);
const inputAccessToken = ref<HTMLInputElement | null>(null);

export default defineComponent({
	components: {
		ApiParameter,
		HighlightedSearchMethod,
	},
	data() {
		// @ts-ignore
		const interfaces = interfacesJson as ApiServices;

		const groupsMap = new Map<string, number>();
		const groupsData = new Map<number, SidebarGroupData>(
			// biome-ignore format: too verbose
			[
				// Order of apps here defines the order in the sidebar
				[0, { name: 'Steam', icon: 'steam.jpg', open: true, methods: {} }],
				[730, { name: 'Counter-Strike 2', icon: 'cs2.jpg', open: true, methods: {} }],
				[570, { name: 'Dota 2', icon: 'dota.jpg', open: true, methods: {} }],
				[440, { name: 'Team Fortress 2', icon: 'tf.jpg', open: true, methods: {} }],
				[1422450, { name: 'Deadlock', icon: 'deadlock.jpg', open: true, methods: {} }],
				[620, { name: 'Portal 2', icon: 'portal2.jpg', open: false, methods: {} }],
				[1046930, { name: 'Dota Underlords', icon: 'underlords.jpg', open: false, methods: {} }],
				[583950, { name: 'Artifact Classic', icon: 'artifact.jpg', open: false, methods: {} }],
				[1269260, { name: 'Artifact Foundry', icon: 'artifact.jpg', open: false, methods: {} }],

				// Beta apps
				[247040, { name: 'Dota 2 Experimental', icon: 'dota.jpg', open: false, methods: {} }],
				[2305270, { name: 'Dota 2 Staging', icon: 'dota.jpg', open: false, methods: {} }],
				[3488080, { name: 'Deadlock Experimental', icon: 'deadlock.jpg', open: false, methods: {} }],
				[3781850, { name: 'Deadlock Unknown', icon: 'deadlock.jpg', open: false, methods: {} }],
			],
		);

		const steamGroup = groupsData.get(0)!;

		for (const interfaceName in interfaces) {
			const interfaceAppid = interfaceName.match(/_(?<appid>[0-9]+)$/);

			if (interfaceAppid) {
				const appid = parseInt(interfaceAppid.groups!.appid, 10);

				groupsMap.set(interfaceName, appid);

				let group = groupsData.get(appid);

				if (!group) {
					group = {
						name: `App ${appid}`,
						icon: 'steam.jpg',
						open: false,
						methods: {},
					};

					groupsData.set(appid, group);
				}

				group.methods[interfaceName] = interfaces[interfaceName];
			} else {
				steamGroup.methods[interfaceName] = interfaces[interfaceName];
			}

			for (const methodName in interfaces[interfaceName]) {
				const method = interfaces[interfaceName][methodName];

				for (const parameter of method.parameters) {
					parameter._value = '';

					if (parameter.type === 'bool') {
						parameter.manuallyToggled = false;
					}
				}
			}
		}

		return {
			userData: {
				webapi_key: '',
				access_token: '',
				steamid: '',
				format: 'json',
				favorites: new Set<string>(),
			},
			skipNextHashChange: false,
			keyInputType: 'password',
			hasValidWebApiKey: false,
			hasValidAccessToken: false,
			accessTokenExpiration: 0,
			accessTokenSteamId: null,
			accessTokenAudience: [],
			accessTokenVisible: false,
			currentFilter: '',
			currentInterface: '',
			search: markRaw(new ApiSearcher(interfaces)),
			interfaces,
			groupsMap,
			groupsData,
		};
	},
	setup() {
		return {
			sidebar,
			inputSearch,
			inputApiKey,
			inputAccessToken,
		};
	},
	watch: {
		'userData.format'(value: string): void {
			localStorage.setItem('format', value);
		},
		'userData.webapi_key'(value: string): void {
			if (this.isFieldValid('webapi_key')) {
				localStorage.setItem('webapi_key', value);
			} else {
				localStorage.removeItem('webapi_key');
			}
		},
		'userData.access_token'(value: string): void {
			try {
				if (value.length > 2 && value[0] === '{' && value[value.length - 1] === '}') {
					const obj = JSON.parse(value);

					if (obj.data?.webapi_token) {
						this.userData.access_token = obj.data.webapi_token;
						return;
					}
				}
				if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) {
					const jwt = value.split('.');
					const token = JSON.parse(atob(jwt[1]));

					this.accessTokenExpiration = token.exp * 1000;
					this.accessTokenAudience = token.aud;
					this.accessTokenSteamId = token.sub;

					if (token.sub && !this.userData.steamid) {
						this.userData.steamid = token.sub;
					}
				} else {
					throw new Error('Invalid token format (or empty)');
				}
			} catch (e) {
				console.log((e as Error).message);
				this.accessTokenExpiration = 0;
				this.accessTokenSteamId = null;
				this.accessTokenAudience = [];
			}

			if (this.isFieldValid('access_token')) {
				localStorage.setItem('access_token', value);
			} else {
				localStorage.removeItem('access_token');
			}
		},
		'userData.steamid'(value: string): void {
			if (this.isFieldValid('steamid')) {
				localStorage.setItem('steamid', value);

				this.fillSteamidParameter();
			} else {
				localStorage.removeItem('steamid');
			}
		},
		currentFilter(newFilter: string, oldFilter: string): void {
			if (!newFilter) {
				this.$nextTick(this.scrollInterfaceIntoView);

				if (oldFilter) {
					this.sidebar!.scrollTop = 0;
				}
			} else {
				this.setInterface('');

				if (!oldFilter) {
					this.sidebar!.scrollTop = 0;
				}
			}
		},
	},
	mounted(): void {
		try {
			this.userData.format = localStorage.getItem('format') || 'json';
			this.userData.steamid = localStorage.getItem('steamid') || '';
			this.userData.webapi_key = localStorage.getItem('webapi_key') || '';
			this.userData.access_token = localStorage.getItem('access_token') || '';

			const favoriteStrings = JSON.parse(localStorage.getItem('favorites') || '[]');

			for (const favorite of favoriteStrings) {
				const [favoriteInterface, favoriteMethod] = favorite.split('/', 2);

				if (
					Object.hasOwn(this.interfaces, favoriteInterface) &&
					Object.hasOwn(this.interfaces[favoriteInterface], favoriteMethod)
				) {
					this.interfaces[favoriteInterface][favoriteMethod].isFavorite = true;

					this.userData.favorites.add(favorite);
				}
			}
		} catch (e) {
			console.error(e);
		}

		if (location.hash.startsWith('#')) {
			this.setInterface(location.hash.substring(1), true);
		}

		window.addEventListener(
			'hashchange',
			() => {
				if (this.skipNextHashChange) {
					this.skipNextHashChange = false;
					return;
				}

				this.setInterface(location.hash.substring(1));
			},
			false,
		);

		this.bindGlobalKeybind();
	},
	computed: {
		sidebarInterfaces(): Map<number, SidebarGroupData> {
			const interfaces = this.filteredInterfaces;

			if (this.currentFilter) {
				return new Map<number, SidebarGroupData>([
					[
						-1,
						{
							name: 'Search results',
							icon: '',
							open: true,
							methods: interfaces,
						},
					],
				]);
			}

			return this.groupsData;
		},
		filteredInterfaces(): ApiServices {
			if (!this.currentFilter) {
				return this.interfaces;
			}

			const matchedInterfaces: ApiServices = {};
			const hits = this.search.search(this.currentFilter);

			for (const match of hits) {
				if (!matchedInterfaces[match.interface]) {
					matchedInterfaces[match.interface] = {};
				}

				const method = this.interfaces[match.interface][match.method];
				method.highlight = match.indices;
				matchedInterfaces[match.interface][match.method] = method;
			}

			return matchedInterfaces;
		},
		currentInterfaceMethods(): ApiInterface {
			return this.interfaces[this.currentInterface];
		},
		uriDelimeterBeforeKey() {
			return this.hasValidAccessToken || this.hasValidWebApiKey ? '?' : '';
		},
		formatAccessTokenExpirationDate(): string {
			const formatter = new Intl.DateTimeFormat('en-US', {
				hourCycle: 'h23',
				dateStyle: 'medium',
				timeStyle: 'short',
			});

			return formatter.format(this.accessTokenExpiration);
		},
	},
	methods: {
		setInterface(interfaceAndMethod: string, setFromUrl = false): void {
			const split = interfaceAndMethod.split('/', 2);
			let currentInterface: string | null = split[0];
			let currentMethod: string | null = split.length > 1 ? split[1] : null;

			if (!Object.hasOwn(this.interfaces, currentInterface)) {
				currentInterface = null;
				currentMethod = null;
			} else if (currentMethod !== null && !Object.hasOwn(this.interfaces[currentInterface], currentMethod)) {
				currentMethod = null;
			}

			this.currentInterface = currentInterface || '';

			if (currentInterface) {
				document.title = `${currentInterface} – Steam Web API Documentation`;
			} else {
				document.title = `Steam Web API Documentation`;
			}

			// Since we won't scroll to a method, scroll to top (as there is no element with just interface id)
			if (document.scrollingElement && !currentMethod) {
				document.scrollingElement.scrollTop = 0;
			}

			if (setFromUrl) {
				return;
			}

			this.$nextTick(() => {
				this.skipNextHashChange = true;

				if (currentMethod) {
					location.hash = `#${currentInterface}/${currentMethod}`;
				} else if (currentInterface) {
					location.hash = `#${currentInterface}`;
				} else {
					location.hash = '';
				}
			});
		},
		fillSteamidParameter(): void {
			if (!this.userData.steamid) {
				return;
			}

			for (const interfaceName in this.interfaces) {
				for (const methodName in this.interfaces[interfaceName]) {
					for (const parameter of this.interfaces[interfaceName][methodName].parameters) {
						if (!parameter._value && parameter.name.includes('steamid')) {
							parameter._value = this.userData.steamid;
						}
					}
				}
			}
		},
		isFieldValid(field: string): boolean {
			switch (field) {
				case 'access_token':
					this.hasValidAccessToken = this.accessTokenExpiration > Date.now();
					return this.hasValidAccessToken;

				case 'webapi_key':
					this.hasValidWebApiKey = /^[0-9a-f]{32}$/i.test(this.userData[field]);
					return this.hasValidWebApiKey;

				case 'steamid':
					return /^[0-9]{17}$/.test(this.userData[field]);
			}

			return false;
		},
		renderUri(methodName: string, method: ApiMethod): string {
			let host = 'https://api.steampowered.com/';

			if (method._type === 'publisher_only') {
				host = 'https://partner.steam-api.com/';
			}

			return `${host}${this.currentInterface}/${methodName}/v${method.version}/`;
		},
		renderApiKey(): string {
			const parameters = new URLSearchParams();

			if (this.hasValidAccessToken) {
				parameters.set('access_token', this.userData.access_token);
			} else if (this.hasValidWebApiKey) {
				parameters.set('key', this.userData.webapi_key);
			}

			return parameters.toString();
		},
		renderParameters(method: ApiMethod): string {
			const parameters = new URLSearchParams();

			if (this.userData.format !== 'json') {
				parameters.set('format', this.userData.format);
			}

			let hasArrays = false;
			const inputJson = {} as any;

			for (const parameter of method.parameters) {
				if (parameter.extra) {
					const arr = this.getInnerParameters(parameter);

					if (Object.keys(arr).length > 0) {
						hasArrays = true;

						if (parameter.type?.endsWith('[]')) {
							const paramName = parameter.name.substring(0, parameter.name.length - 3);

							if (!Object.hasOwn(inputJson, paramName)) {
								inputJson[paramName] = [];
							}

							inputJson[paramName].push(arr);
						} else {
							inputJson[parameter.name] = arr;
						}
					} else if (parameter._value) {
						parameters.set(parameter.name, parameter._value);
					}

					continue;
				}

				if (!parameter._value && !parameter.manuallyToggled) {
					continue;
				}

				parameters.set(parameter.name, parameter._value ?? '');
			}

			if (hasArrays) {
				method.hasArrays = true;
				parameters.set('input_json', JSON.stringify(inputJson));
			}

			const str = parameters.toString();

			if (str.length === 0) {
				return '';
			}

			if (this.uriDelimeterBeforeKey) {
				return `&${str}`;
			}

			return `?${str}`;
		},
		getInnerParameters(parameterParent: ApiMethodParameter) {
			const arr = {} as any;

			for (const parameter of parameterParent.extra!) {
				if (parameter.extra) {
					const result = this.getInnerParameters(parameter);

					if (Object.keys(result).length > 0) {
						if (parameter.type?.endsWith('[]')) {
							const paramName = parameter.name.substring(0, parameter.name.length - 3);

							if (!Object.hasOwn(arr, paramName)) {
								arr[paramName] = [];
							}

							arr[paramName].push(result);
						} else {
							arr[parameter.name] = result;
						}
					}

					continue;
				}

				if (!parameter._value && !parameter.manuallyToggled) {
					continue;
				}

				if (parameter.type?.endsWith('[]')) {
					const paramName = parameter.name.substring(0, parameter.name.length - 3);

					if (!Object.hasOwn(arr, paramName)) {
						arr[paramName] = [];
					}

					arr[paramName].push(parameter._value || '');
				} else {
					arr[parameter.name] = parameter._value || '';
				}
			}

			return arr;
		},
		useThisMethod(event: SubmitEvent, method: ApiMethod): void {
			const form = event.target as HTMLFormElement;

			if (method.hasArrays) {
				event.preventDefault();

				if (method.httpmethod === 'POST') {
					alert('Executing POST requests with input_json is not yet supported.');
					return;
				}

				const url = [form.action, this.uriDelimeterBeforeKey, this.renderApiKey(), this.renderParameters(method)].join(
					'',
				);

				try {
					window.open(url, '_blank');
				} catch {
					alert('Failed to open window');
				}

				return;
			}

			if (
				method.httpmethod === 'POST' &&
				!confirm(
					'Executing POST requests could be potentially disastrous.\n\n' +
						'Author is not responsible for any damage done.\n\n' +
						'Are you sure you want to continue?',
				)
			) {
				event.preventDefault();
			}

			for (const field of form.elements) {
				if (!(field instanceof HTMLInputElement)) {
					continue;
				}

				if (!field.value && !field.disabled && field.tagName === 'INPUT') {
					field.disabled = true;

					setTimeout(() => {
						field.disabled = false;
					}, 0);
				}
			}
		},
		addParamArray(method: ApiMethod, parameter: ApiMethodParameter): void {
			if (!parameter._counter) {
				parameter._counter = 1;
			} else {
				parameter._counter++;
			}

			const newParameter: ApiMethodParameter = {
				name: `${parameter.name.substring(0, parameter.name.length - 3)}[${parameter._counter}]`,
				type: parameter.type,
				optional: true,
			};

			if (parameter.extra) {
				newParameter.extra = [];

				for (const parameter2 of parameter.extra!) {
					newParameter.extra.push({
						name: parameter2.name,
						type: parameter2.type,
						optional: true,
					});
				}
			}

			const parameterIndex = method.parameters.findIndex((param) => param.name === parameter.name);
			method.parameters.splice(parameterIndex + parameter._counter, 0, newParameter);
		},
		scrollInterfaceIntoView(): void {
			const element = document.querySelector(`.interface-list a[href="#${this.currentInterface}"]`);

			if (element instanceof HTMLElement) {
				element.scrollIntoView();
			}
		},
		copyUrl(event: MouseEvent): void {
			const button = event.target as Element;
			const element = button.closest('.input-group')!.querySelector('.form-control')!;

			navigator.clipboard.writeText(element.textContent || '').then(
				() => {
					button.classList.add('bg-success');

					setTimeout(() => button.classList.remove('bg-success'), 500);
				},
				() => {
					// write fail
				},
			);
		},
		favoriteMethod(method: ApiMethod, methodName: string): void {
			const name = `${this.currentInterface}/${methodName}`;

			method.isFavorite = !method.isFavorite;

			if (method.isFavorite) {
				this.userData.favorites.add(name);
			} else {
				this.userData.favorites.delete(name);
			}

			localStorage.setItem('favorites', JSON.stringify([...this.userData.favorites]));
		},
		navigateSidebar(direction: number): void {
			const entries = Object.entries(this.filteredInterfaces);
			const index = entries.findIndex((x) => x[0] === this.currentInterface) + direction;
			const size = entries.length;
			const [interfaceName, methods] = entries[((index % size) + size) % size];
			const firstMethodName = Object.keys(methods)[0];

			this.setInterface(`${interfaceName}/${firstMethodName}`);
			this.scrollInterfaceIntoView();

			// This is trash, but the focus gets lost because of location.hash change
			this.$nextTick(() => {
				this.inputSearch?.focus();
			});
		},
		focusApiKey(): void {
			this.currentFilter = '';
			this.setInterface('');

			this.$nextTick(() => {
				const element = this.hasValidAccessToken ? this.inputAccessToken : this.inputApiKey;

				if (element) {
					element.focus();
				}
			});
		},
		onSearchInput(e: Event) {
			requestAnimationFrame(() => {
				this.currentFilter = (e.target as HTMLInputElement).value;
			});
		},
		bindGlobalKeybind() {
			document.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.ctrlKey || e.metaKey) {
					return;
				}

				const target = e.target as HTMLElement;

				if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
					return;
				}

				if (e.key === '/' || e.key === 's') {
					e.preventDefault();
					this.inputSearch?.focus();
				}
			});
		},
	},
});
