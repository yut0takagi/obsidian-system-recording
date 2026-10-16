import Foundation
import AVFoundation
import CoreMedia

enum MixerError: Error, LocalizedError {
    case noAudio
    case formatUnavailable

    var errorDescription: String? {
        switch self {
        case .noAudio: return "No audio was captured"
        case .formatUnavailable: return "Could not set up the audio format"
        }
    }
}

@available(macOS 13.0, *)
final class AudioMixer: @unchecked Sendable {
    private var systemAudioFile: AVAudioFile?
    private var micAudioFile: AVAudioFile?
    private let systemLock = NSLock()
    private let micLock = NSLock()
    private let outputURL: URL
    private var isSystemWriting = false
    private var isMicWriting = false
    private var sampleRate: Double = 48000
    private var totalSystemFrames: AVAudioFrameCount = 0
    private var totalMicFrames: AVAudioFrameCount = 0

    private let systemTempURL: URL
    private let micTempURL: URL

    /// Frames mixed per step in finalize(); keeps memory flat however long the recording is.
    private let chunkFrames: AVAudioFrameCount = 32768

    init(outputURL: URL) throws {
        self.outputURL = outputURL

        let tempDir = NSTemporaryDirectory()
        let pid = ProcessInfo.processInfo.processIdentifier
        systemTempURL = URL(fileURLWithPath: tempDir).appendingPathComponent("sysrec-system-\(pid).wav")
        micTempURL = URL(fileURLWithPath: tempDir).appendingPathComponent("sysrec-mic-\(pid).wav")

        for url in [outputURL, systemTempURL, micTempURL] {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    // MARK: - System audio (from ScreenCaptureKit)

    func appendSystemAudio(_ sampleBuffer: CMSampleBuffer) {
        systemLock.lock()
        defer { systemLock.unlock() }

        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)
        guard numSamples > 0 else { return }

        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc),
              let srcFormat = AVAudioFormat(streamDescription: asbd) else { return }

        if !isSystemWriting {
            do {
                sampleRate = srcFormat.sampleRate
                guard let wavFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: srcFormat.channelCount, interleaved: true) else { return }
                systemAudioFile = try AVAudioFile(forWriting: systemTempURL, settings: wavFormat.settings)
                isSystemWriting = true
            } catch { return }
        }

        // Convert CMSampleBuffer to AVAudioPCMBuffer
        let frameCount = AVAudioFrameCount(numSamples)
        var ablSize: Int = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: &ablSize, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)

        let ablMemory = UnsafeMutablePointer<UInt8>.allocate(capacity: ablSize)
        defer { ablMemory.deallocate() }
        let ablPointer = ablMemory.withMemoryRebound(to: AudioBufferList.self, capacity: 1) { $0 }

        var blockBuffer: CMBlockBuffer?
        let err = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: ablPointer, bufferListSize: ablSize, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &blockBuffer)
        guard err == noErr else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: frameCount) else { return }
        pcmBuffer.frameLength = frameCount

        let ablPtr = UnsafeMutableAudioBufferListPointer(ablPointer)
        let channelCount = Int(srcFormat.channelCount)
        for ch in 0..<min(channelCount, ablPtr.count) {
            if let src = ablPtr[ch].mData, let dst = pcmBuffer.floatChannelData?[ch] {
                memcpy(dst, src, Int(ablPtr[ch].mDataByteSize))
            }
        }

        do {
            try systemAudioFile?.write(from: pcmBuffer)
            totalSystemFrames += pcmBuffer.frameLength
        } catch {}
    }

    // MARK: - Microphone audio (from AVAudioEngine)

    func appendMicrophoneAudio(_ buffer: AVAudioPCMBuffer) {
        micLock.lock()
        defer { micLock.unlock() }

        guard buffer.frameLength > 0 else { return }

        if !isMicWriting {
            do {
                guard let wavFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: buffer.format.sampleRate, channels: buffer.format.channelCount, interleaved: true) else { return }
                micAudioFile = try AVAudioFile(forWriting: micTempURL, settings: wavFormat.settings)
                isMicWriting = true
            } catch { return }
        }

        do {
            try micAudioFile?.write(from: buffer)
            totalMicFrames += buffer.frameLength
        } catch {}
    }

    // MARK: - Finalize: mix system + mic into output

    /// Mixes the system and microphone tracks into a stereo WAV at `outputURL`,
    /// chunk by chunk. Either track may be missing (e.g. no system audio was
    /// played); the microphone is resampled when its rate differs. The temp
    /// tracks are deleted only after the output was written, so a failure
    /// leaves them for recovery. Returns the duration in seconds.
    func finalize() throws -> Double {
        // Close files so their headers are complete
        systemLock.lock()
        systemAudioFile = nil
        systemLock.unlock()

        micLock.lock()
        micAudioFile = nil
        micLock.unlock()

        let systemFile = isSystemWriting ? try? AVAudioFile(forReading: systemTempURL) : nil
        let micFile = isMicWriting ? try? AVAudioFile(forReading: micTempURL) : nil
        let system = (systemFile?.length ?? 0) > 0 ? systemFile : nil
        let mic = (micFile?.length ?? 0) > 0 ? micFile : nil
        guard system != nil || mic != nil else { throw MixerError.noAudio }

        // The system track sets the rate; with only a microphone, keep its rate.
        let rate = system?.processingFormat.sampleRate ?? mic?.processingFormat.sampleRate ?? sampleRate
        guard let mixFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 2, interleaved: false),
              let wavFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 2, interleaved: true),
              let mixBuffer = AVAudioPCMBuffer(pcmFormat: mixFormat, frameCapacity: chunkFrames) else {
            throw MixerError.formatUnavailable
        }
        let outputFile = try AVAudioFile(forWriting: outputURL, settings: wavFormat.settings, commonFormat: .pcmFormatFloat32, interleaved: false)

        let systemReader = try system.map { try TrackReader(file: $0, targetRate: rate, chunkFrames: chunkFrames) }
        let micReader = try mic.map { try TrackReader(file: $0, targetRate: rate, chunkFrames: chunkFrames) }

        var totalFrames: AVAudioFramePosition = 0
        while true {
            for ch in 0..<Int(mixFormat.channelCount) {
                if let data = mixBuffer.floatChannelData?[ch] {
                    memset(data, 0, Int(chunkFrames) * MemoryLayout<Float>.size)
                }
            }

            let systemFrames = try systemReader?.addNext(into: mixBuffer) ?? 0
            let micFrames = try micReader?.addNext(into: mixBuffer) ?? 0
            let frames = max(systemFrames, micFrames)
            if frames == 0 { break }

            // Clip to [-1, 1]
            for ch in 0..<Int(mixFormat.channelCount) {
                if let data = mixBuffer.floatChannelData?[ch] {
                    for i in 0..<Int(frames) {
                        data[i] = max(-1.0, min(1.0, data[i]))
                    }
                }
            }

            mixBuffer.frameLength = frames
            try outputFile.write(from: mixBuffer)
            totalFrames += AVAudioFramePosition(frames)
        }

        // Cleanup temp files
        try? FileManager.default.removeItem(at: systemTempURL)
        try? FileManager.default.removeItem(at: micTempURL)

        return Double(totalFrames) / rate
    }
}

/// Reads one temp track in chunks at the mix rate (resampling when needed)
/// and adds it into a stereo float buffer.
@available(macOS 13.0, *)
private final class TrackReader {
    private let file: AVAudioFile
    private let converter: AVAudioConverter?
    private let readBuffer: AVAudioPCMBuffer
    private let convertedBuffer: AVAudioPCMBuffer?
    private var inputDone = false

    init(file: AVAudioFile, targetRate: Double, chunkFrames: AVAudioFrameCount) throws {
        self.file = file
        let source = file.processingFormat
        if source.sampleRate == targetRate {
            converter = nil
            convertedBuffer = nil
        } else {
            guard let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: targetRate, channels: source.channelCount, interleaved: false),
                  let conv = AVAudioConverter(from: source, to: target),
                  let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: chunkFrames) else {
                throw MixerError.formatUnavailable
            }
            converter = conv
            convertedBuffer = out
        }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: chunkFrames) else {
            throw MixerError.formatUnavailable
        }
        readBuffer = buffer
    }

    /// Adds up to one chunk into `mix` (mono goes to both sides). Returns the frames added; 0 at the end.
    func addNext(into mix: AVAudioPCMBuffer) throws -> AVAudioFrameCount {
        let chunk: AVAudioPCMBuffer
        if let converter = converter, let out = convertedBuffer {
            out.frameLength = 0
            var conversionError: NSError?
            let status = converter.convert(to: out, error: &conversionError) { [self] _, outStatus in
                if inputDone || file.framePosition >= file.length {
                    inputDone = true
                    outStatus.pointee = .endOfStream
                    return nil
                }
                do {
                    try file.read(into: readBuffer, frameCount: readBuffer.frameCapacity)
                } catch {
                    inputDone = true
                    outStatus.pointee = .endOfStream
                    return nil
                }
                if readBuffer.frameLength == 0 {
                    inputDone = true
                    outStatus.pointee = .endOfStream
                    return nil
                }
                outStatus.pointee = .haveData
                return readBuffer
            }
            if status == .error, let conversionError = conversionError { throw conversionError }
            chunk = out
        } else {
            if file.framePosition >= file.length { return 0 }
            try file.read(into: readBuffer, frameCount: readBuffer.frameCapacity)
            chunk = readBuffer
        }

        let frames = min(chunk.frameLength, mix.frameCapacity)
        guard frames > 0, let src = chunk.floatChannelData, let dst = mix.floatChannelData else { return 0 }
        let channels = Int(chunk.format.channelCount)
        for outCh in 0..<2 {
            let inCh = channels == 1 ? 0 : min(outCh, channels - 1)
            let s = src[inCh]
            let d = dst[outCh]
            for i in 0..<Int(frames) {
                d[i] += s[i]
            }
        }
        return frames
    }
}
