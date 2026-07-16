// ============================================================================
// Kontrak event marketplace — ADAPTER PATTERN.
//
// Simulator, impor file, dan (kelak) API Shopee/TikTok asli SEMUANYA
// menghasilkan MarketplaceEvent yang sama dan melewati pipeline ingest yang
// sama (ingest.ts). Mengganti simulator dengan API sungguhan = menulis
// adapter baru yang mengubah webhook/response API menjadi event ini.
// Logika inti TIDAK berubah.
// ============================================================================

export type MarketplaceChannel = "shopee" | "tiktok";

export type EventSource = "simulator" | "import" | "api" | "manual";

/** Item pada pesanan sebagaimana terlihat di marketplace (bisa SKU bundle). */
export interface ListingLine {
  /** SKU listing marketplace — bisa produk satuan ATAU bundle */
  listing_sku: string;
  qty: number;
}

export type MarketplaceEvent =
  | {
      type: "ORDER_CREATED";
      channel: MarketplaceChannel;
      marketplace_order_id: string;
      lines: ListingLine[];
      occurred_at?: string;
    }
  | {
      /**
       * Barang FISIK meninggalkan gudang.
       * Shopee: status SHIPPED. TikTok: status IN_TRANSIT.
       * Keduanya dipetakan ke satu event internal ini (keputusan klien).
       */
      type: "ORDER_SHIPPED";
      channel: MarketplaceChannel;
      marketplace_order_id: string;
      occurred_at?: string;
    }
  | {
      type: "ORDER_DELIVERED";
      channel: MarketplaceChannel;
      marketplace_order_id: string;
      occurred_at?: string;
    }
  | {
      /**
       * Pembatalan — perilaku BERBEDA sebelum vs sesudah kirim (lihat ingest.ts).
       * `lines` opsional = pembatalan PARSIAL per item (Phase 2): hanya baris
       * tersebut yang dibatalkan; tanpa `lines` = seluruh pesanan.
       */
      type: "ORDER_CANCELLED";
      channel: MarketplaceChannel;
      marketplace_order_id: string;
      reason?: string;
      lines?: ListingLine[];
      occurred_at?: string;
    }
  | {
      /**
       * Pembeli mengajukan retur; barang mulai perjalanan kembali.
       * `lines` opsional = retur PARSIAL per item (Phase 2). Retur sebagian
       * dari bundle dikirim sebagai SKU produk satuan — dihitung per produk
       * satuan, bukan seluruh bundle (keputusan klien #4).
       */
      type: "RETURN_CREATED";
      channel: MarketplaceChannel;
      marketplace_order_id: string;
      reason?: string;
      lines?: ListingLine[];
      occurred_at?: string;
    }
  | {
      /** Paket retur tiba di gudang — SIAP DIINSPEKSI (kondisi belum diputuskan). */
      type: "RETURN_RECEIVED";
      channel: MarketplaceChannel;
      marketplace_order_id: string;
      occurred_at?: string;
    };

/**
 * Sumber event marketplace. Implementasi saat ini: simulator & impor file.
 * Implementasi masa depan: polling/webhook API Shopee & TikTok Shop.
 */
export interface MarketplaceEventSource {
  readonly name: EventSource;
  /** Ambil/terima event berikutnya untuk diproses pipeline. */
  pull(): Promise<MarketplaceEvent[]>;
}

export interface IngestResult {
  ok: boolean;
  message: string;
  order_id?: string;
  return_id?: string;
}
