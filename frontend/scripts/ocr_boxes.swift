import AppKit
import Foundation
import Vision

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let box: [Double]
}

struct OCRDocument: Codable {
    let path: String
    let lines: [OCRLine]
}

let imagePaths = Array(CommandLine.arguments.dropFirst())
guard !imagePaths.isEmpty else {
    FileHandle.standardError.write(Data("Usage: ocr_boxes.swift <image> [image ...]\n".utf8))
    exit(2)
}

let documents: [OCRDocument] = try imagePaths.map { imagePath in
    guard let image = NSImage(contentsOfFile: imagePath),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "QFROCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to read \(imagePath)"])
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])

    let lines: [OCRLine] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let bounds = observation.boundingBox
        return OCRLine(
            text: candidate.string,
            confidence: candidate.confidence,
            box: [
                bounds.minX * 1000,
                (1 - bounds.maxY) * 1000,
                bounds.maxX * 1000,
                (1 - bounds.minY) * 1000,
            ]
        )
    }
    return OCRDocument(path: imagePath, lines: lines)
}

let encoder = JSONEncoder()
let data = try encoder.encode(documents)
FileHandle.standardOutput.write(data)
