// Records beta.messages.create requests and replies with queued responses

class FakeAnthropic {
  constructor() {
    this.requests = [];
    this.responses = [];
    this.beta = {
      messages: {
        create: async (params) => {
          this.requests.push(JSON.parse(JSON.stringify(params)));
          const next = this.responses.shift();
          if (next instanceof Error) {
            throw next;
          }
          return next || FakeAnthropic.reply('Default reply');
        }
      }
    };
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
