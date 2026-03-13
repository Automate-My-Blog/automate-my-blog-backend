# WordPress: Images or tweets not showing on the live page

When posts published from Automate My Blog show only caption text (or links) instead of images and tweet embeds, the backend is sending valid HTML and block format; WordPress or the theme is altering it.

## What we send

- **Images:** `<!-- wp:html -->` (Custom HTML block) + `<figure class="wp-block-image"><img src="https://via.placeholder.com/..." alt="..." /></figure>` + `<!-- /wp:html -->` (no inline `style`). Same block type as tweets so both are preserved consistently.
- **Tweets:** `<!-- wp:html -->` + oEmbed/fallback HTML + `<!-- /wp:html -->`.

## Checks on the WordPress side

1. **Block editor (Gutenberg)**  
   Confirm the post is edited with the block editor. In **Settings → Writing**, ensure “Classic editor” is not forced. Posts created via REST API with block comments need the block editor to render blocks correctly.

2. **Theme**  
   Some themes strip `<figure>`, `<img>`, or custom blocks. Temporarily switch to a default theme (e.g. Twenty Twenty-Four) and republish or view the post. If images appear, the theme is filtering the content.

3. **Security / content plugins**  
   Plugins that sanitize post content (e.g. strict KSES, “disable embeds”) can remove `<img>`, `style`, or iframes. Check:
   - Allowed HTML / “unfiltered HTML” for your user role.
   - Whitelisting `via.placeholder.com` (or your image domain) if the plugin blocks external images.

4. **Viewing the stored content**  
   In WordPress admin, edit the post and switch to **Code editor** (block editor). Confirm you see `<!-- wp:image -->` and `<figure>…<img …></figure>`. If you only see text, the content was changed before save (e.g. by a plugin or an older flow).

5. **Re-publish after fixes**  
   After changing theme/plugins or settings, publish a **new** post from Automate My Blog (or re-publish the same post) so the updated content is sent again.

## Backend behavior

- Placeholders `[Image: ...]` and `![IMAGE:...]` are converted to `<figure><img></figure>` and wrapped in `<!-- wp:image -->`.
- Inline `style` attributes are removed from those blocks to reduce the chance of stripping by strict filters.
- If images still do not appear after the checks above, the restriction is on the WordPress/server side (theme, plugin, or host).
