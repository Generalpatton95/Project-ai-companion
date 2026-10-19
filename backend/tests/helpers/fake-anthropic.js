// Records beta.messages requests and replies with queued responses.
// stream() mimics the SDK's BetaMessageStream: 'text' events, then finalMessage().

class FakeAnthropic {
  constructor() {
    this.requests = [];
    this.requestOptions = [];
    this.responses = [];
    this.beta = {
      messages: {
        create: async (params, options = {}) => {
          this.requests.push(JSON.parse(JSON.stringify(params)));
          this.requestOptions.push(options);
          const next = this.next();
          if (next instanceof Error) {
            throw next;
          }
          // A queued function controls when (and whether) the reply arrives
          return typeof next === 'function' ? next(options) : next;
        },
        stream: (params, options = {}) => {
          this.requests.push(JSON.parse(JSON.stringify(params)));
          this.requestOptions.push(options);
          const listeners = [];
          return {
            on: (event, cb) => {
              if (event === 'text') listeners.push(cb);
            },
            finalMessage: async () => {
              const message = this.next();
              if (message instanceof Error) {
                throw message;
              }
              for (const block of message.content) {
                if (block.type !== 'text') continue;
                // Emit in a few chunks, as a real stream would
                for (const chunk of block.text.match(/.{1,8}/gs) || []) {
                  if (options.signal && options.signal.aborted) {
                    throw new Error('Request was aborted.');
                  }
                  listeners.forEach((cb) => cb(chunk));
                  await new Promise((resolve) => setImmediate(resolve));
                }
              }
              return message;
            }
          };
        }
      }
    };
  }

  next() {
    const next = this.responses.shift();
    return next || FakeAnthropic.reply('Default reply');
  }

  queue(...responses) {
    this.responses.push(...responses);
    return this;
  }

  static reply(text, extra = {}) {
    return {
      id: `msg_${Math.random().toString(36).slice(2)}`,
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      stop_details: null,
      content: [
        { type: 'thinking', thinking: '', signature: 'sig-abc' },
        { type: 'text', text }
      ],
      ...extra
    };
  }
}

module.exports = { FakeAnthropic };
