# <img src="src/img/icon-128.png" width="64" alt="Extension Logo"> Wave Shifter 

Wave Shifter is a lightweight open-source browser extension that lets you change the pitch and playback speed of audio and video directly in your browser.

Unlike simple playback-rate controls, Wave Shifter can shift pitch independently from speed, preserve the original pitch while changing playback speed, and apply real-time audio processing using the Web Audio API and Signalsmith Stretch.

## Features

- 🎵 Pitch shifting in semitones (-12 to +12)
- 🎚 Fine pitch adjustment in cents (-50 to +50)
- ⚡ Playback speed control
- 🎼 Optional pitch preservation when changing speed
- 🧠 Smart processing mode for improved performance
- 🔧 Adjustable processing block size
- 🎥 Works with HTML5 audio and video elements
- 🚀 Real-time processing using AudioWorklets
- 🌐 Fully client-side processing
- 📚 Support for popular libraries (for example [howler.js](https://github.com/goldfire/howler.js))
- 🚫 Blacklist functionality
- 🔓 Free and open source

## Demo
For testing such extensions, it is best to use demo websites where audio and video elements are hidden or encapsulated within third-party libraries such as howler.js. This is the standard behavior for most streaming services.

for example: https://vinylkafka.vercel.app/

## Installation

### From Store

To install the Chromium version of the extension:
1. Go to the [marketplace](https://chromewebstore.google.com/detail/wave-shifter-key-tune-pit/niejfkfliccnmakpegpfadmhlgpkoghj) 
2. Click "Add to Chrome"

Versions for other browsers are not supported yet

### From Source

1. Clone the repository:

```bash
git clone https://github.com/your-name/wave-shifter.git
```

2. Open Chrome or another Chromium-based browser.

3. Navigate to:

```
chrome://extensions
```

4. Enable **Developer mode**.

5. Click **Load unpacked**.

6. Select the project directory.

The extension is now installed.

## Usage

1. Open a webpage containing audio or video.
2. Start media playback.
3. Open the Wave Shifter popup.
4. Adjust the controls as desired.

### Pitch Shift

Changes the musical pitch of the audio.

- Positive values increase pitch
- Negative values decrease pitch

### Pitch Fine Shifting

Allows precise pitch adjustments in cents.

- 100 cents = 1 semitone

### Block Size

Controls the processing window size.

Smaller values:

- Lower latency
- Higher CPU usage
- More artifacts may appear

Larger values:

- Better audio quality
- Higher latency
- Lower CPU usage

### Smart Processing

Enables optimized processing settings for most use cases.

### Speed Shift

Changes playback speed.

### Speed Fine Shifting

Provides precise playback-speed adjustments.

### Preserve Pitch

Keeps the original pitch while changing playback speed.

When disabled, changing speed will affect pitch naturally, similar to tape playback.

## How It Works

Wave Shifter injects an AudioWorklet into the page and routes media elements through a real-time pitch-shifting processor powered by Signalsmith Stretch.

Audio processing is performed locally in the browser. No audio data is sent to external servers.

## Limitations

### Cross-Origin Audio Restrictions

Some websites serve media without CORS permissions.

In these cases, browsers intentionally block access to the audio stream for security reasons, preventing audio processing through the Web Audio API.

You may see messages similar to:

```text
MediaElementAudioSource outputs zeroes due to CORS access restrictions
```

When this occurs, pitch shifting cannot be applied to that media source.

### Protected Media

Encrypted or DRM-protected content may not be accessible for processing.

### Browser Support

Wave Shifter relies on:

- Web Audio API
- AudioWorklet
- MediaElementAudioSourceNode

Modern Chromium-based browsers are recommended.

## Privacy

Wave Shifter:

- Does not collect personal data
- Does not track users
- Does not send audio to external servers
- Does not require an account

All processing happens locally in your browser.

## Third-Party Software

Wave Shifter uses:

### Signalsmith Stretch

High-quality real-time time-stretching and pitch-shifting library.

Project:

https://github.com/Signalsmith-Audio/signalsmith-stretch

Please refer to the original project for licensing information.

## Development

Project structure:

```text
wave-shifter/
├── manifest.json
├── popup.html
├── popup.js
├── content.js
├── page-hook.js
├── __pitch_shifter_worklet.js
└── src/
    └── js/
        └── SignalsmithStretch.min.js
```

## Contributing

Issues, bug reports, feature requests, and pull requests are welcome.

Please open an issue before submitting large changes.

## License

MIT License
