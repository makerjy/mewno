// Decode the first local audio track to mono, 16 kHz signed little-endian PCM.
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#include <stdio.h>

int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 3) return 1;
        NSURL *url = [NSURL fileURLWithFileSystemRepresentation:argv[1] isDirectory:NO relativeToURL:nil];
        // Refuse playlists and URL references. AVFoundation may only read local files.
        AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:@{
            AVURLAssetReferenceRestrictionsKey: @(AVAssetReferenceRestrictionForbidAll)
        }];
        AVAssetTrack *track = [asset tracksWithMediaType:AVMediaTypeAudio].firstObject;
        if (!track || asset.hasProtectedContent) return 2;
        AVAssetReader *reader = [[AVAssetReader alloc] initWithAsset:asset error:nil];
        NSDictionary *pcm = @{ AVFormatIDKey:@(kAudioFormatLinearPCM), AVSampleRateKey:@16000,
            AVNumberOfChannelsKey:@1, AVLinearPCMBitDepthKey:@16, AVLinearPCMIsFloatKey:@NO,
            AVLinearPCMIsBigEndianKey:@NO, AVLinearPCMIsNonInterleaved:@NO };
        AVAssetReaderTrackOutput *out = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:track outputSettings:pcm];
        if (![reader canAddOutput:out]) return 3;
        [reader addOutput:out];
        if (![reader startReading]) return 4;
        FILE *file = fopen(argv[2], "wb");
        if (!file) return 5;
        unsigned char buffer[32768];
        UInt64 frames = 0;
        while (reader.status == AVAssetReaderStatusReading) {
            @autoreleasepool {
                CMSampleBufferRef sample = [out copyNextSampleBuffer];
                if (!sample) break;
                // Keep timeline gaps (e.g. delayed audio in a video) aligned with playback.
                double pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample));
                if (!isfinite(pts) || pts > 24 * 3600) { CFRelease(sample); fclose(file); return 6; }
                UInt64 start = pts > 0 ? (UInt64)llround(pts * 16000) : 0;
                if (start > frames + 1) {
                    if (fseeko(file, (off_t)start * 2, SEEK_SET)) { CFRelease(sample); fclose(file); return 5; }
                    frames = start;
                }
                CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
                if (!block) { CFRelease(sample); fclose(file); return 3; }
                size_t count = CMBlockBufferGetDataLength(block);
                for (size_t offset = 0; offset < count;) {
                    size_t size = MIN(sizeof(buffer), count - offset);
                    if (CMBlockBufferCopyDataBytes(block, offset, size, buffer) ||
                        fwrite(buffer, 1, size, file) != size) { CFRelease(sample); fclose(file); return 5; }
                    offset += size;
                }
                frames += count / 2;
                CFRelease(sample);
            }
        }
        if (fclose(file)) return 5;
        return reader.status == AVAssetReaderStatusCompleted && frames ? 0 : 4;
    }
}
