import type {
	AiApplySuggestionRequestDto,
	AiAskRequestDto,
	AiChatRequestDto,
} from '@n8n/api-types';
import { GlobalConfig } from '@n8n/config';
import { Service } from '@n8n/di';
import { AiAssistantClient } from '@n8n_io/ai-assistant-sdk';
import { assert, type IUser } from 'n8n-workflow';
import axios, { type AxiosInstance } from 'axios';

import { N8N_VERSION } from '../constants';
import { License } from '../license';

@Service()
export class AiService {
	private client: AiAssistantClient | undefined;
	private customHttpClient: AxiosInstance | undefined;
	private useCustomEndpoint: boolean = false;

	constructor(
		private readonly licenseService: License,
		private readonly globalConfig: GlobalConfig,
	) {}

	async init() {
		console.log('🚀 AI Service init() called');
		const aiAssistantEnabled = this.licenseService.isAiAssistantEnabled();
		console.log('🔧 AI Assistant enabled:', aiAssistantEnabled);

		// Force enable AI Assistant for custom endpoint
		if (!aiAssistantEnabled) {
			console.log(
				'⚠️ AI Assistant not enabled by license, but proceeding anyway for custom endpoint',
			);
		}

		// Try to get from environment variables directly as fallback
		const baseUrl = this.globalConfig.aiAssistant.baseUrl || process.env.N8N_AI_ASSISTANT_BASE_URL;
		const apiKey = this.globalConfig.aiAssistant.apiKey || process.env.N8N_AI_ASSISTANT_API_KEY;
		const model = this.globalConfig.aiAssistant.model || process.env.N8N_AI_MODEL;

		console.log('🔧 AI Service init - baseUrl (config):', this.globalConfig.aiAssistant.baseUrl);
		console.log('🔧 AI Service init - baseUrl (env):', process.env.N8N_AI_ASSISTANT_BASE_URL);
		console.log('🔧 AI Service init - baseUrl (final):', baseUrl);
		console.log(
			'🔧 AI Service init - apiKey exists (config):',
			!!this.globalConfig.aiAssistant.apiKey,
		);
		console.log(
			'🔧 AI Service init - apiKey exists (env):',
			!!process.env.N8N_AI_ASSISTANT_API_KEY,
		);
		console.log('🔧 AI Service init - apiKey exists (final):', !!apiKey);
		console.log('🔧 AI Service init - model (final):', model);
		console.log('🔧 AI Service init - globalConfig.aiAssistant:', this.globalConfig.aiAssistant);

		// Check if we should use custom endpoint
		if (baseUrl && apiKey) {
			console.log('🔧 Configuring custom AI endpoint:', baseUrl);
			console.log('🔧 Using model:', model || 'Default');
			this.useCustomEndpoint = true;
			this.customHttpClient = axios.create({
				baseURL: baseUrl,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'User-Agent': `n8n/${N8N_VERSION}`,
					...(model && { 'X-Model': model }),
				},
				timeout: 30000,
			});
		} else {
			// Use original AiAssistantClient
			const licenseCert = await this.licenseService.loadCertStr();
			const consumerId = this.licenseService.getConsumerId();
			const logLevel = this.globalConfig.logging.level;

			this.client = new AiAssistantClient({
				licenseCert,
				consumerId,
				n8nVersion: N8N_VERSION,
				baseUrl: baseUrl || '',
				logLevel,
			});
		}
	}

	async chat(payload: AiChatRequestDto, user: IUser) {
		if (!this.client && !this.customHttpClient) {
			await this.init();
		}

		console.log('🔍 AI Service chat called - useCustomEndpoint:', this.useCustomEndpoint);
		console.log('🔍 customHttpClient exists:', !!this.customHttpClient);
		console.log('🔍 client exists:', !!this.client);

		if (this.useCustomEndpoint && this.customHttpClient) {
			// Use custom endpoint
			try {
				console.log(
					'🤖 Sending request to custom AI endpoint:',
					this.globalConfig.aiAssistant.baseUrl + '/v1/chat/completions',
				);

				// Convert n8n chat payload to OpenAI format
				const openAIPayload = {
					model: this.globalConfig.aiAssistant.model || process.env.N8N_AI_MODEL || 'gpt-3.5-turbo',
					messages: [
						{
							role: 'user',
							content: JSON.stringify(payload),
						},
					],
					stream: false,
					user: user.id,
				};

				const response = await this.customHttpClient.post('/v1/chat/completions', openAIPayload);
				console.log('✅ Custom AI endpoint response status:', response.status);

				// Convert OpenAI response back to n8n format
				const aiResponse = response.data;
				return {
					sessionId: payload.sessionId,
					messages: [
						{
							role: 'assistant',
							type: 'message',
							text: aiResponse.choices?.[0]?.message?.content || 'No response from AI service',
						},
					],
				};
			} catch (error) {
				console.error(
					'❌ Custom AI endpoint error:',
					error.response?.status,
					error.response?.data || error.message,
				);
				throw new Error(
					`Custom AI service error: ${error.response?.status || 'Unknown'} - ${error.response?.data?.message || error.message}`,
				);
			}
		}

		// Use original AiAssistantClient
		assert(this.client, 'Assistant client not setup');
		return await this.client.chat(payload, { id: user.id });
	}

	async applySuggestion(payload: AiApplySuggestionRequestDto, user: IUser) {
		if (!this.client && !this.customHttpClient) {
			await this.init();
		}

		if (this.useCustomEndpoint && this.customHttpClient) {
			// Use custom endpoint
			try {
				console.log(
					'🤖 Sending request to custom AI endpoint:',
					this.globalConfig.aiAssistant.baseUrl + '/v1/chat/completions',
				);

				// Convert n8n applySuggestion payload to OpenAI format
				const openAIPayload = {
					model: this.globalConfig.aiAssistant.model || process.env.N8N_AI_MODEL || 'gpt-3.5-turbo',
					messages: [
						{
							role: 'system',
							content:
								'You are an AI assistant helping to apply code suggestions in n8n workflows. Apply the requested suggestion and return the updated parameters.',
						},
						{
							role: 'user',
							content: `Apply suggestion: ${JSON.stringify(payload)}`,
						},
					],
					stream: false,
					user: user.id,
				};

				const response = await this.customHttpClient.post('/v1/chat/completions', openAIPayload);
				console.log('✅ Custom AI endpoint response status:', response.status);

				// Convert OpenAI response back to n8n applySuggestion format
				const aiResponse = response.data;
				return {
					sessionId: payload.sessionId,
					parameters: JSON.parse(aiResponse.choices?.[0]?.message?.content || '{}'),
				};
			} catch (error) {
				console.error(
					'❌ Custom AI endpoint error:',
					error.response?.status,
					error.response?.data || error.message,
				);
				throw new Error(
					`Custom AI service error: ${error.response?.status || 'Unknown'} - ${error.response?.data?.message || error.message}`,
				);
			}
		}

		// Use original AiAssistantClient
		assert(this.client, 'Assistant client not setup');
		return await this.client.applySuggestion(payload, { id: user.id });
	}

	async askAi(payload: AiAskRequestDto, user: IUser) {
		if (!this.client && !this.customHttpClient) {
			await this.init();
		}

		if (this.useCustomEndpoint && this.customHttpClient) {
			// Use custom endpoint
			try {
				console.log(
					'🤖 Sending request to custom AI endpoint:',
					this.globalConfig.aiAssistant.baseUrl + '/v1/chat/completions',
				);

				// Convert n8n askAi payload to OpenAI format
				const openAIPayload = {
					model: this.globalConfig.aiAssistant.model || process.env.N8N_AI_MODEL || 'gpt-3.5-turbo',
					messages: [
						{
							role: 'system',
							content:
								"You are an AI assistant helping with n8n workflow automation. Answer the user's question about their workflow or code.",
						},
						{
							role: 'user',
							content: `Question: ${payload.question}\n\nContext: ${JSON.stringify(payload.context, null, 2)}\n\nFor node: ${payload.forNode}`,
						},
					],
					stream: false,
					user: user.id,
				};

				const response = await this.customHttpClient.post('/v1/chat/completions', openAIPayload);
				console.log('✅ Custom AI endpoint response status:', response.status);

				// Convert OpenAI response back to n8n askAi format
				const aiResponse = response.data;
				return {
					answer: aiResponse.choices?.[0]?.message?.content || 'No response from AI service',
					code: '', // Required by AskAiResponsePayload interface
				};
			} catch (error) {
				console.error(
					'❌ Custom AI endpoint error:',
					error.response?.status,
					error.response?.data || error.message,
				);
				throw new Error(
					`Custom AI service error: ${error.response?.status || 'Unknown'} - ${error.response?.data?.message || error.message}`,
				);
			}
		}

		// Use original AiAssistantClient
		assert(this.client, 'Assistant client not setup');
		return await this.client.askAi(payload, { id: user.id });
	}

	async createFreeAiCredits(user: IUser) {
		if (!this.client) {
			await this.init();
		}
		assert(this.client, 'Assistant client not setup');

		return await this.client.generateAiCreditsCredentials(user);
	}
}
