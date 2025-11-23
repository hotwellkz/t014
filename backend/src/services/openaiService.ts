import OpenAI from "openai";
import { Channel } from "../models/channel";

// Инициализация OpenAI клиента (ленивая инициализация)
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY не установлен в переменных окружения");
    }
    openai = new OpenAI({
      apiKey,
      timeout: 60000, // 60 секунд таймаут
      maxRetries: 2, // 2 попытки при ошибке
    });
  }
  return openai;
}

export interface Idea {
  id: string;
  title: string;
  description: string;
}

export interface VeoPromptResult {
  veoPrompt: string;
  videoTitle: string;
}

export interface IdeaAndPromptResult {
  ideaText: string; // Краткое описание идеи (title + description)
  veoPrompt: string; // Промпт для Veo 3.1 Fast
  videoTitle: string; // Название для YouTube
}

/**
 * Генерирует идеи для видео на основе шаблона канала
 * @param channel - Канал с шаблоном промпта
 * @param theme - Дополнительная тема (опционально)
 * @param count - Количество идей (по умолчанию 5)
 */
export async function generateIdeas(
  channel: Channel,
  theme: string | null,
  count: number = 5
): Promise<Idea[]> {
  try {
    // Формируем промпт для генерации идей
    let prompt = channel.ideaPromptTemplate;

    // Подставляем параметры канала
    prompt = prompt.replace(/{{DURATION}}/g, channel.durationSeconds.toString());
    prompt = prompt.replace(/{{LANGUAGE}}/g, channel.language);
    prompt = prompt.replace(/{{DESCRIPTION}}/g, channel.description);

    // Добавляем дополнительную тему, если указана
    if (theme && theme.trim()) {
      prompt += `\n\nДополнительная тема для использования: ${theme.trim()}`;
    }

    // Убеждаемся, что запрашиваем JSON формат
    if (!prompt.includes("JSON")) {
      prompt += "\n\nВерни ответ строго в формате JSON: массив объектов с полями title и description.";
    }

    console.log("[OpenAI] Generating ideas with prompt:", prompt.substring(0, 200) + "...");

    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini", // Используем недорогую модель
      messages: [
        {
          role: "system",
          content:
            "Ты помощник для генерации идей коротких видео. Всегда возвращай ответ строго в формате JSON-массива с объектами, содержащими поля title и description.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.9, // Больше креативности
      max_tokens: 2000,
      response_format: { type: "json_object" }, // Принудительный JSON режим
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI вернул пустой ответ");
    }

    console.log("[OpenAI] Raw response:", content.substring(0, 200) + "...");

    // Парсим JSON ответ
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Если ответ не JSON, пытаемся извлечь JSON из текста
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Не удалось распарсить JSON ответ от OpenAI");
      }
    }

    // Извлекаем массив идей
    let ideasArray: any[] = [];
    if (Array.isArray(parsed)) {
      ideasArray = parsed;
    } else if (parsed.ideas && Array.isArray(parsed.ideas)) {
      ideasArray = parsed.ideas;
    } else if (parsed.data && Array.isArray(parsed.data)) {
      ideasArray = parsed.data;
    } else {
      // Пытаемся найти любой массив в объекте
      const arrayKey = Object.keys(parsed).find((key) => Array.isArray(parsed[key]));
      if (arrayKey) {
        ideasArray = parsed[arrayKey];
      } else {
        throw new Error("Не найден массив идей в ответе OpenAI");
      }
    }

    // Преобразуем в формат Idea с генерацией ID
    const ideas: Idea[] = ideasArray.slice(0, count).map((item, index) => ({
      id: `idea_${Date.now()}_${index}`,
      title: item.title || item.name || `Идея ${index + 1}`,
      description: item.description || item.text || "",
    }));

    if (ideas.length === 0) {
      throw new Error("Не удалось сгенерировать идеи");
    }

    console.log(`[OpenAI] Generated ${ideas.length} ideas`);
    return ideas;
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating ideas:", error);
    if (error instanceof Error) {
      throw new Error(`Ошибка генерации идей: ${error.message}`);
    }
    throw new Error("Неизвестная ошибка при генерации идей");
  }
}

/**
 * Генерирует финальный промпт для Veo и название видео на основе идеи
 * @param channel - Канал с шаблоном промпта
 * @param idea - Выбранная идея (title и description)
 */
export async function generateVeoPrompt(
  channel: Channel,
  idea: { title: string; description: string }
): Promise<VeoPromptResult> {
  try {
    // Формируем текст идеи
    const ideaText = `${idea.title}. ${idea.description}`;

    // Подставляем идею в шаблон
    let prompt = channel.videoPromptTemplate.replace(/{{IDEA_TEXT}}/g, ideaText);
    prompt = prompt.replace(/{{IDEA_TITLE}}/g, idea.title);
    prompt = prompt.replace(/{{IDEA_DESCRIPTION}}/g, idea.description);
    prompt = prompt.replace(/{{DURATION}}/g, channel.durationSeconds.toString());
    prompt = prompt.replace(/{{LANGUAGE}}/g, channel.language);

    // Определяем язык для промпта и названия на основе языка канала
    const langMap: Record<string, { prompt: string; title: string }> = {
      ru: {
        prompt: "русском",
        title: "русском",
      },
      kk: {
        prompt: "казахском",
        title: "казахском",
      },
      en: {
        prompt: "английском",
        title: "английском",
      },
    };

    const langInfo = langMap[channel.language] || langMap.ru;
    const promptLangName = langInfo.prompt;
    const titleLangName = langInfo.title;

    console.log(`[OpenAI] Generating Veo prompt with template (language: ${channel.language}):`, prompt.substring(0, 200) + "...");

    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `Ты помощник для генерации промптов для видео. Всегда возвращай ответ строго в формате JSON с полями veo_prompt (промпт для Veo 3.1 Fast на ${promptLangName} языке) и video_title (название для YouTube на ${titleLangName} языке).`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI вернул пустой ответ");
    }

    console.log("[OpenAI] Raw response:", content.substring(0, 200) + "...");

    // Парсим JSON ответ
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      // Fallback: пытаемся извлечь данные из текста
      const veoMatch = content.match(/veo_prompt["\s:]+"([^"]+)"/i) || 
                       content.match(/veo_prompt["\s:]+([^\n}]+)/i);
      const titleMatch = content.match(/video_title["\s:]+"([^"]+)"/i) ||
                         content.match(/video_title["\s:]+([^\n}]+)/i);
      
      if (veoMatch && titleMatch) {
        parsed = {
          veo_prompt: veoMatch[1].trim(),
          video_title: titleMatch[1].trim(),
        };
      } else {
        throw new Error("Не удалось распарсить JSON ответ от OpenAI");
      }
    }

    const veoPrompt = parsed.veo_prompt || parsed.veoPrompt || parsed.prompt || "";
    const videoTitle = parsed.video_title || parsed.videoTitle || parsed.title || idea.title;

    if (!veoPrompt) {
      throw new Error("Не удалось получить промпт для Veo из ответа OpenAI");
    }

    console.log("[OpenAI] Generated Veo prompt and title");
    return {
      veoPrompt: veoPrompt.trim(),
      videoTitle: videoTitle.trim(),
    };
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating Veo prompt:", error);
    if (error instanceof Error) {
      throw new Error(`Ошибка генерации промпта: ${error.message}`);
    }
    throw new Error("Неизвестная ошибка при генерации промпта");
  }
}

/**
 * Генерирует название видео на основе промпта для Veo
 * @param prompt - Финальный промпт для Veo 3.1 Fast
 * @param channelName - Название канала (опционально, для контекста)
 * @param language - Язык названия (по умолчанию "ru")
 */
export async function generateTitle(
  prompt: string,
  channelName?: string,
  language: string = "ru"
): Promise<string> {
  try {
    const client = getOpenAIClient();

    // Формируем system prompt
    const langMap: Record<string, string> = {
      ru: "русском",
      kk: "казахском",
      en: "английском",
    };
    const langName = langMap[language] || "русском";

    let systemPrompt = `Ты придумываешь короткие названия для вирусных вертикальных видео (8 секунд) для соцсетей: YouTube Shorts, TikTok, Reels. На основе данного описания видео придумай ОДНО цепляющее название на ${langName} языке, не длиннее 60 символов. Не используй кавычки, эмодзи и хэштеги. Верни только само название, без пояснений.`;

    // Добавляем контекст канала, если есть
    if (channelName) {
      systemPrompt += `\n\nКонтекст канала: ${channelName}. Учти стиль и тематику канала при создании названия.`;
    }

    // Формируем user prompt
    let userPrompt = `Описание видео:\n${prompt}`;

    console.log("[OpenAI] Generating title for prompt:", prompt.substring(0, 100) + "...");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.8, // Креативность для названий
      max_tokens: 100,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI вернул пустой ответ");
    }

    // Очищаем название от кавычек, эмодзи и лишних символов
    let title = content.trim();
    
    // Убираем кавычки в начале и конце
    title = title.replace(/^["'«»]|["'«»]$/g, "");
    
    // Убираем эмодзи и хэштеги
    title = title.replace(/[#@]\w+/g, "");
    title = title.replace(/[\u{1F300}-\u{1F9FF}]/gu, "");
    
    // Обрезаем до 60 символов
    if (title.length > 60) {
      title = title.substring(0, 60).trim();
      // Обрезаем по последнему пробелу, если возможно
      const lastSpace = title.lastIndexOf(" ");
      if (lastSpace > 40) {
        title = title.substring(0, lastSpace);
      }
    }

    console.log(`[OpenAI] Generated title: ${title}`);
    return title;
  } catch (error: unknown) {
    console.error("[OpenAI] Error generating title:", error);
    if (error instanceof Error) {
      throw new Error(`Ошибка генерации названия: ${error.message}`);
    }
    throw new Error("Неизвестная ошибка при генерации названия");
  }
}

/**
 * Генерирует идею, Veo-промпт и название видео одним запросом (упрощённый пайплайн)
 * @param channel - Канал с шаблонами промптов
 * @returns Объект с ideaText, veoPrompt и videoTitle
 */
export async function generateIdeaAndPrompt(
  channel: Channel
): Promise<IdeaAndPromptResult> {
  try {
    console.log(`[OpenAI] 🚀 Generating idea + Veo prompt + title in one request for channel ${channel.id}`);
    
    // Формируем комбинированный промпт
    let ideaPrompt = channel.ideaPromptTemplate;
    ideaPrompt = ideaPrompt.replace(/{{DURATION}}/g, channel.durationSeconds.toString());
    ideaPrompt = ideaPrompt.replace(/{{LANGUAGE}}/g, channel.language);
    ideaPrompt = ideaPrompt.replace(/{{DESCRIPTION}}/g, channel.description);

    // Определяем язык для промпта и названия
    const langMap: Record<string, { prompt: string; title: string }> = {
      ru: { prompt: "русском", title: "русском" },
      kk: { prompt: "казахском", title: "казахском" },
      en: { prompt: "английском", title: "английском" },
    };
    const langInfo = langMap[channel.language] || langMap.ru;
    const promptLangName = langInfo.prompt;
    const titleLangName = langInfo.title;

    // Формируем шаблон для Veo-промпта (без подстановки идеи, так как идея будет сгенерирована)
    let veoPromptTemplate = channel.videoPromptTemplate;
    veoPromptTemplate = veoPromptTemplate.replace(/{{DURATION}}/g, channel.durationSeconds.toString());
    veoPromptTemplate = veoPromptTemplate.replace(/{{LANGUAGE}}/g, channel.language);
    // Убираем плейсхолдеры идеи, так как идея будет сгенерирована в этом же запросе
    veoPromptTemplate = veoPromptTemplate.replace(/{{IDEA_TEXT}}/g, "[ИДЕЯ_БУДЕТ_ПОДСТАВЛЕНА]");
    veoPromptTemplate = veoPromptTemplate.replace(/{{IDEA_TITLE}}/g, "[ЗАГОЛОВОК_ИДЕИ]");
    veoPromptTemplate = veoPromptTemplate.replace(/{{IDEA_DESCRIPTION}}/g, "[ОПИСАНИЕ_ИДЕИ]");

    // Формируем единый промпт для AI
    const combinedPrompt = `Задача: сгенерировать идею для короткого видео (${channel.durationSeconds} секунд) и сразу создать промпт для Veo 3.1 Fast.

Шаг 1 - Идея:
${ideaPrompt}

Шаг 2 - Veo-промпт:
Используй следующую структуру для создания промпта:
${veoPromptTemplate}

Требования:
- Идея должна быть креативной и подходить для короткого вертикального видео
- Veo-промпт должен быть на ${promptLangName} языке и описывать визуальный сюжет для Veo 3.1 Fast
- Название видео должно быть на ${titleLangName} языке, не длиннее 60 символов, без кавычек и эмодзи

Верни ответ строго в формате JSON с полями:
{
  "idea_title": "краткий заголовок идеи",
  "idea_description": "подробное описание идеи для видео",
  "veo_prompt": "детальный промпт для Veo 3.1 Fast на ${promptLangName} языке",
  "video_title": "название для YouTube на ${titleLangName} языке (макс 60 символов)"
}`;

    console.log(`[OpenAI] Combined prompt length: ${combinedPrompt.length} chars`);
    console.log(`[OpenAI] Channel: ${channel.name}, Language: ${channel.language}, Duration: ${channel.durationSeconds}s`);

    const client = getOpenAIClient();
    const startTime = Date.now();
    
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Ты помощник для генерации идей и промптов для коротких видео. Всегда возвращай ответ строго в формате JSON с полями idea_title, idea_description, veo_prompt, video_title.`,
        },
        {
          role: "user",
          content: combinedPrompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const duration = Date.now() - startTime;
    console.log(`[OpenAI] ✅ Response received in ${duration}ms`);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI вернул пустой ответ");
    }

    console.log(`[OpenAI] Raw response length: ${content.length} chars`);
    console.log(`[OpenAI] Raw response preview: ${content.substring(0, 300)}...`);

    // Парсим JSON ответ
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("[OpenAI] ❌ JSON parse error:", parseError);
      // Пытаемся извлечь JSON из текста
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error(`Не удалось распарсить JSON ответ от OpenAI: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }
      } else {
        throw new Error(`Не удалось распарсить JSON ответ от OpenAI: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    }

    // Извлекаем данные
    const ideaTitle = parsed.idea_title || parsed.ideaTitle || parsed.title || "";
    const ideaDescription = parsed.idea_description || parsed.ideaDescription || parsed.description || "";
    const veoPrompt = parsed.veo_prompt || parsed.veoPrompt || parsed.prompt || "";
    let videoTitle = parsed.video_title || parsed.videoTitle || ideaTitle || "";

    // Валидация
    if (!ideaTitle || !ideaDescription) {
      throw new Error("Не удалось получить идею из ответа OpenAI (отсутствуют idea_title или idea_description)");
    }
    if (!veoPrompt) {
      throw new Error("Не удалось получить Veo-промпт из ответа OpenAI");
    }

    // Очищаем название от кавычек, эмодзи и лишних символов
    videoTitle = videoTitle.trim();
    videoTitle = videoTitle.replace(/^["'«»]|["'«»]$/g, "");
    videoTitle = videoTitle.replace(/[#@]\w+/g, "");
    videoTitle = videoTitle.replace(/[\u{1F300}-\u{1F9FF}]/gu, "");
    
    // Обрезаем до 60 символов
    if (videoTitle.length > 60) {
      videoTitle = videoTitle.substring(0, 60).trim();
      const lastSpace = videoTitle.lastIndexOf(" ");
      if (lastSpace > 40) {
        videoTitle = videoTitle.substring(0, lastSpace);
      }
    }

    // Если название пустое, используем заголовок идеи
    if (!videoTitle) {
      videoTitle = ideaTitle.substring(0, 60);
    }

    const ideaText = `${ideaTitle}: ${ideaDescription}`;

    console.log(`[OpenAI] ✅ Generated:`);
    console.log(`[OpenAI]    Idea: "${ideaTitle}"`);
    console.log(`[OpenAI]    Veo prompt length: ${veoPrompt.length} chars`);
    console.log(`[OpenAI]    Video title: "${videoTitle}"`);

    return {
      ideaText,
      veoPrompt: veoPrompt.trim(),
      videoTitle: videoTitle.trim(),
    };
  } catch (error: unknown) {
    console.error("[OpenAI] ❌ Error in generateIdeaAndPrompt:", error);
    if (error instanceof Error) {
      // Проверяем на таймаут
      if (error.message.includes("timeout") || error.message.includes("TIMEOUT")) {
        throw new Error(`Таймаут при генерации идеи и промпта: ${error.message}`);
      }
      // Проверяем на проблемы с сетью
      if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
        throw new Error(`Проблема с подключением к OpenAI API: ${error.message}`);
      }
      throw new Error(`Ошибка генерации идеи и промпта: ${error.message}`);
    }
    throw new Error("Неизвестная ошибка при генерации идеи и промпта");
  }
}

