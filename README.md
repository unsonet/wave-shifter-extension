# <img src="src/img/icon-128.png" width="64" alt="Extension Logo"> Wave Shifter 

Wave Shifter is a lightweight open-source browser extension that lets you change the pitch and playback speed of audio and video directly in your browser.

Unlike simple playback-rate controls, Wave Shifter can shift pitch independently from speed, preserve the original pitch while changing playback speed, and apply real-time audio processing using the Web Audio API and Signalsmith Stretch.

## Features

- 🎵 Pitch shifting in semitones (-12 to +12)
- 🎚 Fine pitch adjustment in cents (-50 to +50)
- ⚡ Playback speed control
- 🎼 Optional pitch preservation when changing playback speed
- 🔊 Volume boost
- 🎚 10-band equalizer
- 🌊 Reverb with multiple room presets (Ambience, Chamber, Hall, Plate, Space)
- 🎛 Adjustable reverb depth
- 🎧 Stereo widener
- ⚖ Stereo channel balance control
- 🎚 Dynamic range compressor with configurable threshold, knee, ratio, attack and release
- 🎸 Lo-Fi effects (Distortion, Bitcrusher, CD Skipper, Vinyl) with layer-based routing and mix control
- ⏱ Stereo ping-pong delay with time, feedback, and mix controls
- 🎹 10 modulation effects (Chorus, Flanger, Phaser, Tremolo, Vibrato, Rotary Speaker, Ring Modulator, Vowel Filter, Auto Panner, Auto Filter) with layer-based chaining
- 🎬 Experimental Dolby Surround (5.1) upmix
- 🧠 Smart processing mode for improved performance
- 🔧 Adjustable processing block size
- 🎥 Works with HTML5 audio and video elements
- 📚 Support for popular audio libraries (including howler.js)
- 🔄 Automatically detects dynamically created media elements
- ⚙ Automatic fallback when WebAssembly is blocked by Content Security Policy (CSP)
- 🚫 Configurable website blacklist
- 🚀 Real-time processing using AudioWorklets
- 🌐 Fully client-side audio processing
- 🔓 Free and open source

## Recommended Testing Websites

The following websites are useful for verifying different aspects of Wave Shifter compatibility.

| Website | Purpose |
|---------|---------|
| https://vinylkafka.vercel.app/ | Uses howler.js internally instead of exposing native HTML5 audio elements. Useful for testing integration with third-party audio libraries. |
| https://en.wikipedia.org/wiki/File:Caroline,_No.ogg | Hosts a cross-origin static audio file. Useful for verifying CORS handling and MediaElementAudioSource compatibility. |
| https://www.reddit.com/r/psychedelicrock/comments/1ugqfz3/ | Reddit enforces a restrictive Content Security Policy that blocks injected WebAssembly. Useful for verifying the automatic JavaScript fallback processor. |
| https://www.youtube.com/shorts | Continuously replaces media elements while scrolling. Useful for testing automatic media detection and reconnection. |
| https://open.spotify.com/ | Streams audio in short media segments. Useful for testing processing stability on modern streaming services. |

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

### Volume Boost

Applies additional gain after audio processing.

Useful for quiet recordings or content with low output volume.

### Equalizer

Wave Shifter includes a 10-band graphic equalizer covering the full audible frequency range.

Each band can be adjusted independently to tailor the sound to your preferences.

### Spatial Processing

Wave Shifter provides several spatial audio effects.

#### Reverb

Adds room ambience using convolution reverb.

Available presets include:

- Ambience
- Chamber
- Hall
- Plate
- Space

#### Reverb Depth

Controls the wet/dry mix of the selected reverb.

#### Stereo Widener

Expands the stereo image by increasing the perceived width of the audio.

#### Channel Balance

Adjusts the balance between the left and right audio channels.

### Dynamics

Wave Shifter includes a configurable dynamic range compressor.

Available controls:

- Threshold
- Knee
- Ratio
- Attack
- Release

The compressor can reduce excessive peaks and produce a more consistent listening experience.

### Lo-Fi

Wave Shifter includes a set of lo-fi audio effects that can be layered and mixed together.

Available effects:

- **Distortion**: Applies waveshaping distortion with adjustable amount and tone.
- **Bitcrusher**: Reduces bit depth and sample rate for a crunchy, digital lo-fi sound.
- **CD Skipper**: Simulates a skipping CD by looping small segments of audio.
- **Vinyl**: Adds vinyl record artifacts such as hiss and crackle.

Effects can be stacked in any order using the layer system. Each layer has its own parameters, and the overall wet/dry balance is controlled by the Mix slider.

### Delay

Wave Shifter features a stereo ping-pong delay effect.

Available controls:

- **Time**: Controls the delay time in milliseconds.
- **Feedback**: Controls how much of the delayed signal is fed back into the delay line. Higher values produce longer repeating echoes.
- **Mix**: Controls the wet/dry balance of the delay effect.

The delay alternates between the left and right channels to create a wide, spatial echo effect.

### Modulation

Wave Shifter provides 10 modulation effects that can be chained together in any order using a layer-based system.

Available effects:

- **Chorus**
- **Flanger**
- **Phaser**
- **Tremolo**
- **Vibrato**
- **Rotary Speaker**
- **Ring Modulator**
- **Vowel Filter**
- **Auto Panner**
- **Auto Filter**

Each layer has independent parameters such as rate, depth, and effect-specific options. Layers are processed in the order they are added.



### Surround

Experimental Dolby Surround (5.1) upmix.

When enabled, stereo audio is expanded into a virtual 5.1 channel layout using the Web Audio API.

Availability depends on browser capabilities and the connected audio device.

## How It Works

Wave Shifter injects an AudioWorklet into the page and routes HTML5 media elements through a custom audio processing graph built with the Web Audio API.

The processing pipeline may include:

- Pitch shifting
- Time stretching
- Equalization
- Lo-Fi effects
- Modulation effects
- Delay
- Reverb
- Stereo widening
- Dynamic compression
- Surround upmix
- Volume adjustment

Whenever possible, Wave Shifter uses the high-quality Signalsmith Stretch engine compiled to WebAssembly.

If WebAssembly execution is blocked by the website's Content Security Policy (CSP), Wave Shifter automatically falls back to a pure JavaScript processing engine to preserve compatibility.

All processing is performed locally inside your browser. No audio data is transmitted to external servers.

## Supported Media

Wave Shifter supports:

- HTML5 `<audio>`
- HTML5 `<video>`
- dynamically created media elements
- media players based on howler.js
- most modern streaming websites that expose HTML5 media

Media elements added after page load are detected automatically.

## Limitations

### Content Security Policy

Some websites restrict WebAssembly execution inside injected scripts.

Wave Shifter automatically detects this situation and switches to a JavaScript-based processing engine whenever possible.

Depending on browser restrictions, audio quality and CPU usage may differ between processing engines.

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
├── background.js
├── rules.json
├── __pitch_shifter_worklet.js
└── src/
    └── js/
        ├── SignalsmithStretch.min.js
        ├── audio-effects-worklet.js
        └── pitch-correlator-processor.js
```

## Contributing

Issues, bug reports, feature requests, and pull requests are welcome.

Please open an issue before submitting large changes.

## License

MIT License
