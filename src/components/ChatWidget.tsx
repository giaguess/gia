import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import logoGia from '/logo-gia.png';

interface Message {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  options?: string[];
}

// ─── n8n Webhook Configuration ───────────────────────────────────────────────
const WEBHOOK_URL = 'https://gwebhook.guesstech.com.br/webhook/gia';

// Generates a unique session ID per browser tab to maintain conversation context
const SESSION_ID = crypto.randomUUID();
// ─────────────────────────────────────────────────────────────────────────────

const formatMessageText = (text: string) => {
  const lines = text.split(/(?:\r\n|\r|\n|\\n)/);

  return lines.map((line, i) => {
    const parts: any[] = [];
    let currentText = line;

    // Regexes to match markdown links and plain URLs
    const markdownRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;
    const plainUrlRegex = /(https?:\/\/[^\s]+)/;

    while (currentText.length > 0) {
      const mdMatch = currentText.match(markdownRegex);
      const plainMatch = currentText.match(plainUrlRegex);

      let firstMatch: {
        index: number;
        length: number;
        text: string;
        url: string;
        isMarkdown: boolean;
      } | null = null;

      if (mdMatch && mdMatch.index !== undefined) {
        firstMatch = {
          index: mdMatch.index,
          length: mdMatch[0].length,
          text: mdMatch[1],
          url: mdMatch[2],
          isMarkdown: true
        };
      }

      if (plainMatch && plainMatch.index !== undefined) {
        const rawUrl = plainMatch[0];
        let urlLength = rawUrl.length;

        // Strip trailing punctuation (like closing parenthesis, periods, etc.)
        while (urlLength > 0 && /[),.:;!?]/.test(rawUrl[urlLength - 1])) {
          const openParens = (rawUrl.slice(0, urlLength).match(/\(/g) || []).length;
          const closeParens = (rawUrl.slice(0, urlLength).match(/\)/g) || []).length;
          if (rawUrl[urlLength - 1] === ')' && closeParens > openParens) {
            urlLength--;
          } else if (rawUrl[urlLength - 1] !== ')') {
            urlLength--;
          } else {
            break;
          }
        }

        const cleanUrl = rawUrl.slice(0, urlLength);

        if (cleanUrl.length > 0) {
          // Plain URL match is selected if it occurs before the markdown match (if any)
          if (!firstMatch || plainMatch.index < firstMatch.index) {
            firstMatch = {
              index: plainMatch.index,
              length: cleanUrl.length,
              text: cleanUrl,
              url: cleanUrl,
              isMarkdown: false
            };
          }
        }
      }

      if (firstMatch) {
        // Add plain text before the match
        if (firstMatch.index > 0) {
          parts.push(currentText.slice(0, firstMatch.index));
        }

        // Add the formatted link element
        parts.push(
          <a
            key={parts.length}
            href={firstMatch.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00dbff] underline hover:text-white transition-colors break-all"
          >
            {firstMatch.text}
          </a>
        );

        // Advance currentText pointer past the match
        currentText = currentText.slice(firstMatch.index + firstMatch.length);
      } else {
        // No matches found, add remaining text
        parts.push(currentText);
        break;
      }
    }

    return (
      <span key={i}>
        {parts}
        {i !== lines.length - 1 && <br />}
      </span>
    );
  });
};

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'bot',
      text: 'Olá! Eu sou a gIA, a Inteligência Artificial para sua imobiliária. Como posso te ajudar hoje?',
      options: ['Quero alugar um imóvel', 'Segunda via de boleto', 'Preciso do meu extrato']
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Scroll only inside the chat container — never the page
  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isTyping) return;

    const userMsg: Message = { id: Date.now().toString(), sender: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    const requestBody = { message: text, sessionId: SESSION_ID };

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const headersObj: Record<string, string> = {};
      response.headers.forEach((value, key) => { headersObj[key] = value; });

      const rawBody = await response.text();

      if (!response.ok) {
        throw new Error(`Webhook returned status ${response.status}`);
      }

      // Handles n8n AI Agent response formats:
      //   - Array:  [{ output: "..." }]  (most common from AI Agent node)
      //   - Object: { output: "..." } or { text: "..." } or { message: "..." }
      //   - Plain text body
      let botReply = 'Não entendi sua solicitação. Por favor, tente novamente.';
      const contentType = headersObj['content-type'] ?? '';

      if (contentType.includes('application/json')) {
        try {
          const data = JSON.parse(rawBody);
          // n8n AI Agent node returns an array: [{ output: "..." }]
          if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            botReply = first?.output ?? first?.text ?? first?.message ?? JSON.stringify(first);
          } else {
            botReply = data?.output ?? data?.text ?? data?.message ?? JSON.stringify(data);
          }
        } catch {
          botReply = rawBody.trim() || botReply;
        }
      } else {
        botReply = rawBody.trim() || botReply;
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: botReply,
      }]);

    } catch (error) {
      console.error('[gIA Webhook Error]', error);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: 'Desculpe, estou com dificuldade de me conectar agora. Por favor, tente novamente em instantes.',
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <section id="chat" className="py-24 bg-gradient-to-b from-[#002233] to-[#001a26] relative overflow-hidden">
      <div className="container mx-auto px-6 relative z-10 flex justify-center">

        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-4xl bg-[#00111a] border border-[#00dbff]/20 rounded-2xl shadow-2xl shadow-[#00dbff]/10 flex flex-col md:flex-row overflow-hidden"
        >
          {/* Chat Info / Sidebar */}
          <div className="w-full md:w-1/3 bg-[#001a26] p-8 border-b md:border-b-0 md:border-r border-[#00dbff]/10 flex flex-col justify-between">
            <div>
              <img
                src={logoGia}
                alt="gIA"
                className="h-10 w-auto object-contain mb-6"
              />
              <h3 className="text-2xl font-bold text-white mb-3">Experimente a gIA</h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Interaja com o nosso componente de demonstração
                <br />
                A gIA pode ser integrada facilmente em seu site ou WhatsApp
              </p>
              <h6 className="text-sm font-bold text-white mb-3">Esta é uma versão de demonstração e todos os dados são fictícios</h6>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-[#00dbff]">
                <div className="w-2 h-2 rounded-full bg-[#00dbff] animate-pulse"></div>
                gIA Conectada
              </div>
              <div className="text-xs text-gray-500">Powered by Guess Tech</div>
            </div>
          </div>

          {/* Chat Interface */}
          <div className="w-full md:w-2/3 h-[500px] flex flex-col bg-[#000a0f]">
            {/* Header */}
            <div className="p-4 border-b border-[#00dbff]/10 bg-[#00111a] flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#00dbff]/20 flex items-center justify-center">
                <Bot className="w-6 h-6 text-[#00dbff]" />
              </div>
              <div>
                <h4 className="text-white font-semibold">gIA AI</h4>
                <p className="text-xs text-[#00dbff]">Assistente Imobiliária</p>
              </div>
            </div>

            {/* Messages Area */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`flex gap-3 max-w-[85%] ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${msg.sender === 'user' ? 'bg-[#007799]' : 'bg-[#00dbff]/20'}`}>
                      {msg.sender === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-[#00dbff]" />}
                    </div>
                    <div>
                      <div className={`p-4 rounded-2xl text-sm leading-relaxed ${msg.sender === 'user' ? 'bg-[#007799] text-white rounded-tr-sm' : 'bg-[#001a26] text-gray-200 border border-[#00dbff]/10 rounded-tl-sm'}`}>
                        {formatMessageText(msg.text)}
                      </div>
                      {msg.options && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.options.map((opt, i) => (
                            <button
                              key={i}
                              onClick={() => handleSend(opt)}
                              className="px-4 py-2 text-xs rounded-full border border-[#00dbff]/30 text-[#00dbff] hover:bg-[#00dbff]/10 transition-colors"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-3 items-center">
                  <div className="w-8 h-8 rounded-full bg-[#00dbff]/20 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-[#00dbff]" />
                  </div>
                  <div className="bg-[#001a26] border border-[#00dbff]/10 p-4 rounded-2xl rounded-tl-sm flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-[#00dbff] animate-spin" />
                    <span className="text-xs text-gray-400">gIA está processando...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-[#00111a] border-t border-[#00dbff]/10">
              <form
                onSubmit={(e) => { e.preventDefault(); handleSend(inputText); }}
                className="flex items-center gap-3 bg-[#000a0f] border border-[#00dbff]/20 rounded-xl p-2 focus-within:border-[#00dbff] transition-colors"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Digite sua mensagem para a gIA..."
                  className="flex-1 bg-transparent border-none outline-none text-white text-sm px-3 placeholder-gray-500"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isTyping}
                  className="w-10 h-10 rounded-lg bg-[#00dbff] text-[#002233] flex items-center justify-center hover:bg-[#00aacc] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </div>
        </motion.div>

      </div>
    </section>
  );
}
