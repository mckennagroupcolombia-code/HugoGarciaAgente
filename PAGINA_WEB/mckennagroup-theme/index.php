<?php
/**
 * Plantilla principal — página de inicio
 */
get_header(); ?>

<?php if (is_front_page() && !is_home()): ?>
    <!-- Página principal estática (Elementor / editor de bloques) -->
    <?php while (have_posts()): the_post(); ?>
        <?php the_content(); ?>
    <?php endwhile; ?>

<?php elseif (is_home()): ?>
    <!-- ── ARCHIVE DE BLOG ── -->
    <section class="page-hero">
        <div class="container">
            <span class="page-hero-badge">McKenna Group</span>
            <h1>Blog</h1>
            <p>Noticias, artículos técnicos y novedades del sector</p>
        </div>
    </section>

    <div class="container page-content">
        <div class="shop-layout">
            <main class="shop-main">
                <?php if (have_posts()): ?>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;">
                    <?php while (have_posts()): the_post(); ?>
                    <article id="post-<?php the_ID(); ?>" <?php post_class('blog-card'); ?>>
                        <?php if (has_post_thumbnail()): ?>
                        <a href="<?php the_permalink(); ?>">
                            <?php the_post_thumbnail('large', ['style' => 'width:100%;height:220px;object-fit:cover;']); ?>
                        </a>
                        <?php endif; ?>
                        <div style="padding:28px;">
                            <div style="font-size:0.65rem;color:var(--text-muted);font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">
                                <?php echo esc_html(get_the_date()); ?>
                            </div>
                            <h2 style="font-size:1.1rem;margin-bottom:10px;letter-spacing:-0.3px;">
                                <a href="<?php the_permalink(); ?>" style="color:var(--text-dark);">
                                    <?php the_title(); ?>
                                </a>
                            </h2>
                            <div style="color:var(--text-soft);font-size:0.875rem;margin-bottom:20px;line-height:1.7;">
                                <?php the_excerpt(); ?>
                            </div>
                            <a href="<?php the_permalink(); ?>" class="btn btn-outline btn-sm">
                                Leer más <i class="ph ph-arrow-right"></i>
                            </a>
                        </div>
                    </article>
                    <?php endwhile; ?>
                </div>
                <?php the_posts_navigation(); ?>
                <?php else: ?>
                <p style="color:var(--text-muted);">No hay entradas disponibles.</p>
                <?php endif; ?>
            </main>
            <aside class="shop-sidebar">
                <?php dynamic_sidebar('blog-sidebar'); ?>
            </aside>
        </div>
    </div>

<?php else: ?>
    <!-- ══════════════════════════════════════════════
         HERO — split layout (izquierda oscura / derecha blanca)
    ══════════════════════════════════════════════ -->
    <section class="hero">

        <!-- Panel izquierdo -->
        <div class="hero-left">
            <span class="hero-badge">🌿 Materias Primas Certificadas</span>

            <h1 class="hero-title">
                Ingredientes que<br>
                <em>transforman</em><br>
                tu industria
            </h1>

            <p class="hero-subtitle">
                Más de 15 años proveyendo materias primas farmacéuticas y cosméticas a la industria colombiana con los más altos estándares de calidad.
            </p>

            <div class="hero-cta">
                <?php if (function_exists('wc_get_page_id')): ?>
                <a href="<?php echo esc_url(get_permalink(wc_get_page_id('shop'))); ?>"
                   class="btn btn-primary btn-lg">
                    <i class="ph ph-storefront"></i>
                    Ver Catálogo
                </a>
                <?php endif; ?>
                <a href="<?php echo esc_url(home_url('/contacto/')); ?>"
                   class="btn btn-ghost btn-lg">
                    Solicitar Cotización
                </a>
            </div>
        </div>

        <!-- Panel derecho -->
        <div class="hero-right">
            <div class="hero-right-label">Por qué elegirnos</div>
            <div class="hero-features">
                <div class="hero-feature-item">
                    <div class="hero-feat-dot dot-1">
                        <i class="ph ph-certificate"></i>
                    </div>
                    <div class="hero-feat-info">
                        <h3>Calidad Certificada</h3>
                        <p>Productos con cumplimiento de normas INVIMA</p>
                    </div>
                </div>
                <div class="hero-feature-item">
                    <div class="hero-feat-dot dot-2">
                        <i class="ph ph-package"></i>
                    </div>
                    <div class="hero-feat-info">
                        <h3>Despacho Nacional</h3>
                        <p>Envíos a todo Colombia con trazabilidad</p>
                    </div>
                </div>
                <div class="hero-feature-item">
                    <div class="hero-feat-dot dot-3">
                        <i class="ph ph-headset"></i>
                    </div>
                    <div class="hero-feat-info">
                        <h3>Asesoría Técnica</h3>
                        <p>Equipo especializado en formulación</p>
                    </div>
                </div>
                <div class="hero-feature-item">
                    <div class="hero-feat-dot dot-4">
                        <i class="ph ph-chart-line-up"></i>
                    </div>
                    <div class="hero-feat-info">
                        <h3>Stock Permanente</h3>
                        <p>Disponibilidad y precios competitivos</p>
                    </div>
                </div>
            </div>
        </div>

    </section>

    <!-- ── FEATURES STRIP ── -->
    <section class="features-strip section-sm">
        <div class="container">
            <div class="features-grid">
                <div class="feature-item reveal">
                    <div class="feature-icon"><i class="ph ph-certificate"></i></div>
                    <div class="feature-text">
                        <strong>Calidad Certificada</strong>
                        <span>Normas INVIMA</span>
                    </div>
                </div>
                <div class="feature-item reveal reveal-delay-1">
                    <div class="feature-icon"><i class="ph ph-package"></i></div>
                    <div class="feature-text">
                        <strong>Despacho Nacional</strong>
                        <span>Envíos a todo Colombia</span>
                    </div>
                </div>
                <div class="feature-item reveal reveal-delay-2">
                    <div class="feature-icon"><i class="ph ph-headset"></i></div>
                    <div class="feature-text">
                        <strong>Asesoría Técnica</strong>
                        <span>Equipo especializado</span>
                    </div>
                </div>
                <div class="feature-item reveal reveal-delay-3">
                    <div class="feature-icon"><i class="ph ph-clock"></i></div>
                    <div class="feature-text">
                        <strong>Stock Permanente</strong>
                        <span>Disponibilidad inmediata</span>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- ── CATEGORÍAS ── -->
    <section class="section categories-section">
        <div class="container">
            <div class="section-header-split reveal">
                <div class="section-number">01</div>
                <div>
                    <span class="section-eyebrow">Nuestro Portafolio</span>
                    <h2 style="margin-bottom:12px;">Explora por <em style="font-style:italic;font-weight:300;color:var(--green);">Categoría</em></h2>
                    <p style="color:var(--text-soft);font-size:1rem;max-width:520px;line-height:1.8;">
                        Encuentra exactamente lo que necesitas para tu formulación farmacéutica o cosmética.
                    </p>
                </div>
            </div>

            <div class="categories-list-grid">
                <?php
                $cats = get_terms([
                    'taxonomy'   => 'product_cat',
                    'hide_empty' => true,
                    'number'     => 24,
                    'orderby'    => 'count',
                    'order'      => 'DESC',
                    'parent'     => 0,
                ]);
                if (!is_wp_error($cats)):
                    foreach ($cats as $i => $cat):
                        $thumb_id = get_term_meta($cat->term_id, 'thumbnail_id', true);
                        $delay    = $i % 4;
                ?>
                <a href="<?php echo esc_url(get_term_link($cat)); ?>"
                   class="category-pill reveal reveal-delay-<?php echo $delay; ?>">
                    <?php if ($thumb_id): ?>
                        <?php echo wp_get_attachment_image($thumb_id, [24, 24], false, ['style' => 'width:24px;height:24px;object-fit:cover;border-radius:4px;flex-shrink:0;']); ?>
                    <?php else: ?>
                        <i class="ph ph-flask" style="color:var(--green);flex-shrink:0;font-size:1.1rem;"></i>
                    <?php endif; ?>
                    <span><?php echo esc_html($cat->name); ?></span>
                    <span class="cat-count"><?php echo esc_html($cat->count); ?></span>
                </a>
                <?php endforeach; endif; ?>
            </div>
        </div>
    </section>

    <!-- ── PRODUCTOS DESTACADOS ── -->
    <section class="section products-section">
        <div class="container">
            <div class="section-header-split reveal" style="margin-bottom:48px;">
                <div class="section-number">02</div>
                <div>
                    <span class="section-eyebrow">Más Vendidos</span>
                    <h2 style="margin-bottom:0;">Productos <em style="font-style:italic;font-weight:300;color:var(--green);">Destacados</em></h2>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end;margin-bottom:32px;">
                <?php if (function_exists('wc_get_page_id')): ?>
                <a href="<?php echo esc_url(get_permalink(wc_get_page_id('shop'))); ?>"
                   class="btn btn-outline btn-sm">
                    Ver todos <i class="ph ph-arrow-right"></i>
                </a>
                <?php endif; ?>
            </div>

            <?php
            $featured = new WP_Query([
                'post_type'      => 'product',
                'posts_per_page' => 8,
                'orderby'        => 'popularity',
                'order'          => 'DESC',
            ]);
            if ($featured->have_posts()):
                echo '<ul class="products">';
                while ($featured->have_posts()):
                    $featured->the_post();
                    wc_get_template_part('content', 'product');
                endwhile;
                echo '</ul>';
                wp_reset_postdata();
            endif;
            ?>
        </div>
    </section>

    <!-- ── BANNER CTA ── -->
    <section class="section-sm">
        <div class="container">
            <div class="banner-cta reveal">
                <span class="hero-badge" style="margin-bottom:28px;display:inline-block;">Atención Personalizada</span>
                <h2>¿Necesitas una cotización<br><em style="font-style:italic;font-weight:300;">personalizada?</em></h2>
                <p>Nuestro equipo técnico está listo para asesorarte en la selección de materias primas para tu formulación específica.</p>
                <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
                    <a href="https://wa.me/573001234567?text=Hola%2C%20quiero%20una%20cotización"
                       target="_blank" rel="noopener" class="btn btn-primary btn-lg">
                        <i class="ph ph-whatsapp-logo"></i>
                        Escríbenos por WhatsApp
                    </a>
                    <a href="<?php echo esc_url(home_url('/contacto/')); ?>"
                       class="btn btn-ghost btn-lg">
                        Formulario de Contacto
                    </a>
                </div>
            </div>
        </div>
    </section>

<?php endif; ?>

<?php get_footer(); ?>
