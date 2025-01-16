// src/schemas/whatsapp-webhook.schema.ts

import { z } from 'zod';

export const whatsappWebhookSchemas = {
  /**
   * Schema for incoming webhook verification
   */
  verify: z.object({
    query: z.object({
      'hub.mode': z.enum(['subscribe']),
      'hub.verify_token': z.string(),
      'hub.challenge': z.string(),
    }),
  }),

  /**
   * Schema for incoming webhook messages
   */
  webhook: z.object({
    body: z.object({
      object: z.literal('whatsapp_business_account'),
      entry: z.array(
        z.object({
          id: z.string(),
          changes: z.array(
            z.object({
              value: z.object({
                messaging_product: z.literal('whatsapp'),
                metadata: z.object({
                  display_phone_number: z.string(),
                  phone_number_id: z.string(),
                }),
                contacts: z
                  .array(
                    z.object({
                      profile: z.object({
                        name: z.string(),
                      }),
                      wa_id: z.string(),
                    }),
                  )
                  .optional(),
                messages: z
                  .array(
                    z.object({
                      from: z.string(),
                      id: z.string(),
                      timestamp: z.string(),
                      type: z.enum([
                        'text',
                        'image',
                        'video',
                        'audio',
                        'document',
                        'location',
                        'contacts',
                        'interactive',
                        'button',
                        'reaction',
                      ]),
                      text: z
                        .object({
                          body: z.string(),
                        })
                        .optional(),
                      image: z
                        .object({
                          id: z.string(),
                          caption: z.string().optional(),
                          mime_type: z.string().optional(),
                          sha256: z.string().optional(),
                          filename: z.string().optional(),
                        })
                        .optional(),
                      video: z
                        .object({
                          id: z.string(),
                          caption: z.string().optional(),
                          mime_type: z.string().optional(),
                          sha256: z.string().optional(),
                          filename: z.string().optional(),
                        })
                        .optional(),
                      audio: z
                        .object({
                          id: z.string(),
                          mime_type: z.string().optional(),
                          sha256: z.string().optional(),
                          voice: z.boolean().optional(),
                        })
                        .optional(),
                      document: z
                        .object({
                          id: z.string(),
                          caption: z.string().optional(),
                          filename: z.string(),
                          mime_type: z.string(),
                        })
                        .optional(),
                      location: z
                        .object({
                          latitude: z.number(),
                          longitude: z.number(),
                          name: z.string().optional(),
                          address: z.string().optional(),
                        })
                        .optional(),
                      contacts: z
                        .array(
                          z.object({
                            name: z.object({
                              formatted_name: z.string(),
                              first_name: z.string().optional(),
                              last_name: z.string().optional(),
                            }),
                            phones: z
                              .array(
                                z.object({
                                  phone: z.string(),
                                  type: z.string().optional(),
                                }),
                              )
                              .optional(),
                          }),
                        )
                        .optional(),
                      interactive: z
                        .object({
                          type: z.enum(['button_reply', 'list_reply']),
                          button_reply: z
                            .object({
                              id: z.string(),
                              title: z.string(),
                            })
                            .optional(),
                          list_reply: z
                            .object({
                              id: z.string(),
                              title: z.string(),
                              description: z.string().optional(),
                            })
                            .optional(),
                        })
                        .optional(),
                      reaction: z
                        .object({
                          message_id: z.string(),
                          emoji: z.string(),
                        })
                        .optional(),
                      context: z
                        .object({
                          from: z.string(),
                          id: z.string(),
                          forwarded: z.boolean().optional(),
                        })
                        .optional(),
                      referral: z
                        .object({
                          source_url: z.string(),
                          source_id: z.string(),
                          source_type: z.enum(['ad', 'post']),
                          headline: z.string().optional(),
                          body: z.string().optional(),
                          ctwa_clid: z.string(),
                        })
                        .optional(),
                    }),
                  )
                  .optional(),
                statuses: z
                  .array(
                    z.object({
                      id: z.string(),
                      status: z.enum(['sent', 'delivered', 'read', 'failed']),
                      timestamp: z.string(),
                      recipient_id: z.string(),
                      conversation: z
                        .object({
                          id: z.string(),
                          origin: z
                            .object({
                              type: z.string(),
                            })
                            .optional(),
                          expiration_timestamp: z.string().optional(),
                        })
                        .optional(),
                      pricing: z
                        .object({
                          billable: z.boolean(),
                          pricing_model: z.string(),
                          category: z.string(),
                        })
                        .optional(),
                      errors: z
                        .array(
                          z.object({
                            code: z.number(),
                            title: z.string(),
                            message: z.string().optional(),
                            error_data: z
                              .object({
                                details: z.string(),
                              })
                              .optional(),
                            href: z.string().optional(),
                          }),
                        )
                        .optional(),
                    }),
                  )
                  .optional(),
              }),
              field: z.string(),
            }),
          ),
        }),
      ),
    }),
  }),
};
