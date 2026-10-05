import { onRequestOptions as __v1_chat_completions_js_onRequestOptions } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/v1/chat/completions.js"
import { onRequestPost as __v1_chat_completions_js_onRequestPost } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/v1/chat/completions.js"
import { onRequestOptions as __api_chat_js_onRequestOptions } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/chat.js"
import { onRequestPatch as __api_chat_js_onRequestPatch } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/chat.js"
import { onRequestPost as __api_chat_js_onRequestPost } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/chat.js"
import { onRequestDelete as __api_data_js_onRequestDelete } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/data.js"
import { onRequestGet as __api_data_js_onRequestGet } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/data.js"
import { onRequestOptions as __api_data_js_onRequestOptions } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/data.js"
import { onRequestPatch as __api_data_js_onRequestPatch } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/data.js"
import { onRequestPost as __api_data_js_onRequestPost } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/data.js"
import { onRequestOptions as __api_generate_js_onRequestOptions } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/generate.js"
import { onRequestPost as __api_generate_js_onRequestPost } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/generate.js"
import { onRequestGet as __api_stats_js_onRequestGet } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/stats.js"
import { onRequestOptions as __api_stats_js_onRequestOptions } from "/app/conversations/6abf8a0737af6a2cf12141a1/modela/functions/api/stats.js"

export const routes = [
    {
      routePath: "/v1/chat/completions",
      mountPath: "/v1/chat",
      method: "OPTIONS",
      middlewares: [],
      modules: [__v1_chat_completions_js_onRequestOptions],
    },
  {
      routePath: "/v1/chat/completions",
      mountPath: "/v1/chat",
      method: "POST",
      middlewares: [],
      modules: [__v1_chat_completions_js_onRequestPost],
    },
  {
      routePath: "/api/chat",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_chat_js_onRequestOptions],
    },
  {
      routePath: "/api/chat",
      mountPath: "/api",
      method: "PATCH",
      middlewares: [],
      modules: [__api_chat_js_onRequestPatch],
    },
  {
      routePath: "/api/chat",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_chat_js_onRequestPost],
    },
  {
      routePath: "/api/data",
      mountPath: "/api",
      method: "DELETE",
      middlewares: [],
      modules: [__api_data_js_onRequestDelete],
    },
  {
      routePath: "/api/data",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_data_js_onRequestGet],
    },
  {
      routePath: "/api/data",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_data_js_onRequestOptions],
    },
  {
      routePath: "/api/data",
      mountPath: "/api",
      method: "PATCH",
      middlewares: [],
      modules: [__api_data_js_onRequestPatch],
    },
  {
      routePath: "/api/data",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_data_js_onRequestPost],
    },
  {
      routePath: "/api/generate",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_generate_js_onRequestOptions],
    },
  {
      routePath: "/api/generate",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_generate_js_onRequestPost],
    },
  {
      routePath: "/api/stats",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_stats_js_onRequestGet],
    },
  {
      routePath: "/api/stats",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_stats_js_onRequestOptions],
    },
  ]