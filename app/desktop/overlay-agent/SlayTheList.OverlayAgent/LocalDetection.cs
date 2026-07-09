using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace SlayTheList.OverlayAgent;

internal static class LocalDetection
{
    /// <summary>
    /// Convert a captured Bitmap to normalized grayscale pixels matching the server's preprocessing.
    /// If no regions, resizes full image to compareSize x compareSize.
    /// With regions, scales to templateW x templateH, extracts each region, resizes each to compareSize x compareSize, concatenates.
    /// </summary>
    public static float[] ToNormalizedPixels(
        Bitmap bitmap,
        int compareSize,
        int templateWidth,
        int templateHeight,
        List<DetectionRegionInfo>? regions = null)
    {
        if (regions is null || regions.Count == 0)
        {
            using var resized = ResizeBitmap(bitmap, compareSize, compareSize);
            return BitmapToGrayscaleFloat(resized);
        }

        // Scale to template size
        using var scaled = ResizeBitmap(bitmap, templateWidth, templateHeight);
        var allPixels = new List<float>();
        foreach (var region in regions)
        {
            var left = Math.Max(0, (int)Math.Round(region.X));
            var top = Math.Max(0, (int)Math.Round(region.Y));
            var width = Math.Min(templateWidth - left, Math.Max(1, (int)Math.Round(region.Width)));
            var height = Math.Min(templateHeight - top, Math.Max(1, (int)Math.Round(region.Height)));

            using var cropped = CropBitmap(scaled, left, top, width, height);
            using var resized = ResizeBitmap(cropped, compareSize, compareSize);
            allPixels.AddRange(BitmapToGrayscaleFloat(resized));
        }
        return allPixels.ToArray();
    }

    /// <summary>
    /// Compute NCC (Normalized Cross Correlation) between two pixel arrays.
    /// Returns value in [0, 1].
    /// </summary>
    public static double ComputeNcc(float[] a, float[] b)
    {
        if (a.Length != b.Length || a.Length == 0) return 0;

        double sumA = 0, sumB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            sumA += a[i];
            sumB += b[i];
        }
        double meanA = sumA / a.Length;
        double meanB = sumB / b.Length;

        double numerator = 0, denomA2 = 0, denomB2 = 0;
        for (int i = 0; i < a.Length; i++)
        {
            double da = a[i] - meanA;
            double db = b[i] - meanB;
            numerator += da * db;
            denomA2 += da * da;
            denomB2 += db * db;
        }
        double denom = Math.Sqrt(denomA2 * denomB2);
        if (denom < 1e-10) return 0;
        double ncc = numerator / denom;
        return Math.Clamp((ncc + 1) / 2, 0, 1);
    }

    /// <summary>
    /// Compute histogram intersection similarity between two pixel arrays.
    /// Returns value in [0, 1].
    /// </summary>
    public static double ComputeHistogramSimilarity(float[] a, float[] b)
    {
        if (a.Length == 0 || b.Length == 0) return 0;
        const int bins = 32;
        var histA = new float[bins];
        var histB = new float[bins];

        for (int i = 0; i < a.Length; i++)
        {
            int binA = Math.Min(bins - 1, (int)(a[i] * bins));
            histA[binA]++;
        }
        for (int i = 0; i < b.Length; i++)
        {
            int binB = Math.Min(bins - 1, (int)(b[i] * bins));
            histB[binB]++;
        }
        for (int i = 0; i < bins; i++)
        {
            histA[i] /= a.Length;
            histB[i] /= b.Length;
        }

        double intersection = 0;
        for (int i = 0; i < bins; i++)
        {
            intersection += Math.Min(histA[i], histB[i]);
        }
        return intersection;
    }

    public static double CombinedScore(float[] test, float[] reference)
    {
        double ncc = ComputeNcc(test, reference);
        double hist = ComputeHistogramSimilarity(test, reference);
        return ncc * 0.7 + hist * 0.3;
    }

    private static Bitmap ResizeBitmap(Bitmap source, int width, int height)
    {
        var dest = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using var g = Graphics.FromImage(dest);
        g.InterpolationMode = InterpolationMode.Bilinear;
        g.DrawImage(source, 0, 0, width, height);
        return dest;
    }

    private static Bitmap CropBitmap(Bitmap source, int x, int y, int width, int height)
    {
        var rect = new Rectangle(x, y, width, height);
        return source.Clone(rect, source.PixelFormat);
    }

    private static float[] BitmapToGrayscaleFloat(Bitmap bitmap)
    {
        var w = bitmap.Width;
        var h = bitmap.Height;
        var result = new float[w * h];
        var data = bitmap.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try
        {
            var stride = data.Stride;
            var scan0 = data.Scan0;
            for (int row = 0; row < h; row++)
            {
                for (int col = 0; col < w; col++)
                {
                    int offset = row * stride + col * 3;
                    byte b = Marshal.ReadByte(scan0, offset);
                    byte g = Marshal.ReadByte(scan0, offset + 1);
                    byte r = Marshal.ReadByte(scan0, offset + 2);
                    // Rec. 709 grayscale (matches sharp's .grayscale())
                    result[row * w + col] = (0.2126f * r + 0.7152f * g + 0.0722f * b) / 255f;
                }
            }
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
        return result;
    }
}
