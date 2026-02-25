import twilio from 'twilio';

const VoiceResponse = twilio.twiml.VoiceResponse;

export default function voiceDoneHandler(req, res) {
  const twiml = new VoiceResponse();
  twiml.say({ language: 'ja-JP', voice: 'Polly.Mizuki' }, 'ご確認ありがとうございます。それでは失礼いたします。');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
}
