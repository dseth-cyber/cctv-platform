import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as imagesService from './images.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';

const mockPrisma = {
  image: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  imageTag: {
    upsert: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mocked(getPrisma).mockReturnValue(mockPrisma as unknown as ReturnType<typeof getPrisma>);

describe('ImagesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchImages', () => {
    it('should return paginated results', async () => {
      const mockImages = [
        {
          id: 'img-1',
          cameraId: 'cam-1',
          originalFilename: 'test.tiff',
          fileSizeBytes: 1024n,
          status: 'completed',
          widthPx: 1920,
          heightPx: 1080,
          capturedAt: new Date(),
          ingestedAt: new Date(),
          processedAt: new Date(),
          deletedAt: null,
          retentionUntil: new Date(),
          checksumSha256: null,
          checksumMd5: null,
          bitDepth: null,
          colorSpace: null,
          compressionType: null,
          compressionRatio: null,
          tiffMetadata: null,
          createdAt: new Date(),
          camera: { name: 'Camera-1' },
          imageFiles: [],
        },
      ];

      mockPrisma.image.count.mockResolvedValue(1);
      mockPrisma.image.findMany.mockResolvedValue(mockImages);

      const result = await imagesService.searchImages({
        page: 1,
        limit: 20,
        sort: 'capturedAt',
        order: 'desc',
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should apply camera filter', async () => {
      mockPrisma.image.count.mockResolvedValue(0);
      mockPrisma.image.findMany.mockResolvedValue([]);

      await imagesService.searchImages({
        page: 1,
        limit: 20,
        cameraId: 'cam-1',
        sort: 'capturedAt',
        order: 'desc',
      });

      expect(mockPrisma.image.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cameraId: 'cam-1',
          }),
        }),
      );
    });
  });

  describe('getImageById', () => {
    it('should return image with relations', async () => {
      const mockImage = {
        id: 'img-1',
        cameraId: 'cam-1',
        originalFilename: 'test.tiff',
        fileSizeBytes: 1024n,
        status: 'completed',
        widthPx: 1920,
        heightPx: 1080,
        capturedAt: new Date(),
        ingestedAt: new Date(),
        processedAt: new Date(),
        deletedAt: null,
        retentionUntil: null,
        checksumSha256: 'abc',
        checksumMd5: 'def',
        bitDepth: 8,
        colorSpace: 'RGB',
        compressionType: 'LZW',
        compressionRatio: null,
        tiffMetadata: { make: 'Basler' },
        createdAt: new Date(),
        camera: { id: 'cam-1', name: 'Camera-1' },
        imageFiles: [{ id: 'f-1', fileType: 'raw', fileSizeBytes: 1024n, mimeType: 'image/tiff', storageClass: 'hot' }],
        imageTags: [{ key: 'defect', value: 'scratch' }],
      };

      mockPrisma.image.findUnique.mockResolvedValue(mockImage);

      const result = await imagesService.getImageById('img-1');
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>).id).toBe('img-1');
    });

    it('should throw NotFoundError for deleted image', async () => {
      mockPrisma.image.findUnique.mockResolvedValue({
        id: 'img-1',
        status: 'deleted',
      });

      await expect(
        imagesService.getImageById('img-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for missing image', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(null);

      await expect(
        imagesService.getImageById('img-missing'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateImageMetadata', () => {
    it('should update metadata fields', async () => {
      const existingImage = {
        id: 'img-1',
        status: 'completed',
      };

      mockPrisma.image.findUnique.mockResolvedValue(existingImage);
      mockPrisma.image.update.mockResolvedValue({
        ...existingImage,
        widthPx: 2048,
        heightPx: 2048,
        colorSpace: 'Mono8',
        imageFiles: [],
        imageTags: [],
      });

      const result = await imagesService.updateImageMetadata('img-1', {
        widthPx: 2048,
        heightPx: 2048,
        colorSpace: 'Mono8',
      });

      expect(result).toBeDefined();
      expect(mockPrisma.image.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'img-1' },
          data: expect.objectContaining({
            widthPx: 2048,
            heightPx: 2048,
            colorSpace: 'Mono8',
          }),
        }),
      );
    });

    it('should throw on missing image', async () => {
      mockPrisma.image.findUnique.mockResolvedValue(null);

      await expect(
        imagesService.updateImageMetadata('img-missing', {}),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('softDeleteImage', () => {
    it('should mark image as deleted', async () => {
      mockPrisma.image.findUnique.mockResolvedValue({
        id: 'img-1',
        status: 'completed',
      });
      mockPrisma.image.update.mockResolvedValue({});

      await imagesService.softDeleteImage('img-1');

      expect(mockPrisma.image.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'img-1' },
          data: expect.objectContaining({
            status: 'deleted',
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should throw on already deleted image', async () => {
      mockPrisma.image.findUnique.mockResolvedValue({
        id: 'img-1',
        status: 'deleted',
      });

      await expect(
        imagesService.softDeleteImage('img-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
