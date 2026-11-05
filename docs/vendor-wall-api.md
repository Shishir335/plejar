# Agency wall API

The server side of agency profiles: a Facebook Page-style wall that a vendor manages from the panel and that
anyone can read in the app. Every route also appears at `/api-docs`.

Wall posts are ordinary posts with a `byAgency` field, so reactions, comments, shares, saves, reports, feeds and
admin moderation all work through the existing `/posts`, `/comments`, `/feed` and `/admin/posts` routes.

## Rules

- **The agency is the author.** Travelers see the agency's name and logo. They never see which staff member wrote a
  post or comment. The panel shows that in `postedBy`.
- **Wall posts are always public.** They appear in everyone's For You feed, and in the Following tab of people who
  follow the agency.
- **A post holds** text and up to 10 items, of which at most 1 is a video. Photos are up to 10 MB, videos up to 100 MB
  (MP4, MOV, WebM).
- **Any staff member** can post, edit, pin and moderate comments. **Only the owner** can edit the profile.
- **A suspended agency** disappears: its wall, posts and feed entries all stop showing.
- **Staff get no personal notifications** for reactions, comments or shares on the wall.

## Vendor panel

Signed-in agency staff, under `/api/v1/agency`.

| Method and path | What it does |
| --- | --- |
| `GET /me` | The agency, including the new profile fields, and `stats` |
| `PATCH /me` | Owner only. Adds `tagline`, `address`, `socialLinks`, `cover` (file), `removeCover=true` |
| `GET /me/followers?cursor&limit` | Who follows the agency, newest first: `followers` (name, photo, verified, `followedAt`), `total`, `nextCursor`. No email or phone |
| `GET /me/posts?status=active\|hidden&cursor&limit` | The wall as staff see it, with the pinned post first and including posts Plejar has hidden |
| `POST /me/posts` | Multipart. `text`, `media` (repeat for each file), `place` or `placeName`, `event` (own tour), `allowComments` |
| `GET /me/posts/:id` | One post |
| `PATCH /me/posts/:id` | The same fields, plus `removeMedia` (repeat for each URL to remove) |
| `DELETE /me/posts/:id` | Removes the post and deletes its files |
| `POST /me/posts/:id/pin` | Keeps this post at the top of the wall, replacing any earlier pin |
| `DELETE /me/posts/:id/pin` | Unpins it |
| `GET /me/posts/:id/comments?sort=newest&cursor` | Top-level comments |
| `POST /me/posts/:id/comments` | `{ text, parent }`. Comments or replies as the agency |
| `GET /me/comments/:id/replies` | Replies to a comment |
| `DELETE /me/comments/:id` | Removes any comment on the wall, with its replies |

Posts here also carry `status`, `moderationNote`, `pinned` and `postedBy`.

`socialLinks` is `{ facebook, instagram, youtube, tiktok }`, sent as JSON or as a JSON string in a form. Each must be
a full `http(s)://` address, and an empty value clears that link.

Text sent as multipart is stored as typed, so the panel must escape it when showing it.

## Travelers and the public

Under `/api/v1`. The three `GET /agencies` routes below need no sign-in.

| Method and path | What it does |
| --- | --- |
| `GET /agencies/:id` | Profile. Adds `cover`, `tagline`, `address`, `socialLinks`, `counts: { posts, photos, videos }` |
| `GET /agencies/:id/posts?cursor&limit` | The wall, newest first, with the pinned post first on the first page |
| `GET /agencies/:id/media?type=image\|video&cursor&limit` | Photos and videos for a grid. Each item has `post`, `caption`, `postedAt` |
| `POST /agencies/:id/follow`, `DELETE /agencies/:id/follow` | Follow or unfollow (already existed) |
| `POST /posts/:id/reactions`, `POST /posts/:id/comments`, `POST /posts/:id/share`, `POST /posts/:id/save`, `POST /posts/:id/report` | Interact with a wall post, the same as any post |

## Drawing a post

```json
{
  "_id": "...",
  "postedAs": "agency",
  "author": { "_id": "<agency id>", "name": "Birishiri Tours", "photo": "", "verified": true },
  "text": "Boat trip this Friday",
  "media": [
    { "type": "image", "url": "...", "width": 1600, "height": 900 },
    { "type": "video", "url": "...", "poster": "...", "duration": 42 }
  ],
  "pinned": false,
  "counts": { "reactions": 3, "comments": 1, "shares": 0 },
  "viewer": { "reaction": null, "saved": false, "isMine": false, "canComment": true }
}
```

- `postedAs` says where tapping the author goes: `agency` opens `/agencies/:id`, `traveler` opens `/people/:id`.
- An empty `author.photo` means no logo, so draw the initials.
- `poster` and `duration` exist only for videos stored on Cloudinary. Allow for them being missing.
- `pinned` is only on `/agencies/:id/posts` and the panel's routes.
- Comments have `postedAs` too. On a comment from the agency, `viewer.isMine` is always false.
- In `GET /notifications`, an agency's reply has `actor: null`, with the agency's name in `title`.
