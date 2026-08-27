import { supabase } from '@/lib/supabase';
import type {
  Review,
  ReviewStatus,
  ReviewSubmission,
  ReviewsBackend,
} from '@/types/reviews';

const REVIEWS_TABLE = 'reviews';
const STORAGE_BUCKET = 'review-photos';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
}

export const reviewsSupabaseBackend: ReviewsBackend = {
  async submitReview(submission: ReviewSubmission) {
    if (!supabase) {
      return { success: false, error: 'Supabase is not configured' };
    }
    try {
      let photoUrl: string | null = null;
      if (submission.photo) {
        const upload = await this.uploadPhoto(submission.photo);
        if (upload.error) return { success: false, error: upload.error };
        photoUrl = upload.url;
      }
      const { error } = await (supabase as any).from(REVIEWS_TABLE).insert({
        name: submission.name,
        location: submission.location || null,
        rating: Math.round(Number(submission.rating)),
        headline: submission.headline,
        review: submission.review,
        photo_url: photoUrl,
        status: 'pending',
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  },

  async getApprovedReviews() {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from(REVIEWS_TABLE)
      .select('*')
      .in('status', ['approved', 'featured'])
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching approved reviews:', error);
      return [];
    }
    return (data as Review[]) || [];
  },

  async getPendingReviews(adminPassword: string) {
    if (!supabase) return [];
    const { data, error } = await (supabase as any).rpc('get_all_reviews', {
      admin_password: adminPassword,
    });
    if (error) {
      console.error('Error fetching pending reviews:', error);
      throw new Error(error.message);
    }
    return (data as Review[]) || [];
  },

  async updateReviewStatus(id: string, status: ReviewStatus, adminPassword: string) {
    if (!supabase) return { success: false, error: 'Supabase is not configured' };
    const { error } = await (supabase as any).rpc('update_review_status', {
      review_id: id,
      new_status: status,
      admin_password: adminPassword,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  },

  async updateReviewContent(
    id: string,
    fields: { name: string; location: string; headline: string; review: string; rating: number },
    adminPassword: string
  ) {
    if (!supabase) return { success: false, error: 'Supabase is not configured' };
    const { error } = await (supabase as any).rpc('update_review_content', {
      review_id: id,
      new_name: fields.name,
      new_location: fields.location || '',
      new_headline: fields.headline,
      new_review: fields.review,
      new_rating: Math.round(Number(fields.rating)),
      admin_password: adminPassword,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  },

  async deleteReview(id: string, adminPassword: string) {
    if (!supabase) return { success: false, error: 'Supabase is not configured' };
    const { error } = await (supabase as any).rpc('delete_review', {
      review_id: id,
      admin_password: adminPassword,
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
  },

  async uploadPhoto(file: File) {
    if (!supabase) return { url: null, error: 'Supabase is not configured' };
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxSize = 5 * 1024 * 1024;
    if (!allowedTypes.includes(file.type))
      return { url: null, error: 'Only JPG, PNG, WebP, or GIF images are allowed.' };
    if (file.size > maxSize)
      return { url: null, error: 'File size must be less than 5MB.' };
    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
      const filePath = `public/${fileName}`;
      const { error: uploadError } = await (supabase as any).storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file);
      if (uploadError) return { url: null, error: uploadError.message };
      const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
      return { url: data.publicUrl };
    } catch (error) {
      return { url: null, error: getErrorMessage(error) };
    }
  },
};
