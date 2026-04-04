</div><!-- #page-content -->

<!-- ===================================================
     FOOTER
     =================================================== -->
<footer id="site-footer" role="contentinfo">
    <div class="container">
        <div class="footer-main">

            <!-- Columna marca -->
            <div class="footer-brand">
                <?php
                $logo_id  = get_theme_mod('custom_logo');
                $logo_url = $logo_id ? wp_get_attachment_image_url($logo_id, 'full') : '';
                if ($logo_url):
                ?>
                    <img src="<?php echo esc_url($logo_url); ?>"
                         alt="<?php bloginfo('name'); ?>"
                         style="filter:brightness(0) invert(1);">
                <?php else: ?>
                    <div class="brand-text" style="color:#fff;font-size:1.1rem;font-weight:700;margin-bottom:16px;">
                        <?php bloginfo('name'); ?>
                        <span style="display:block;font-weight:300;font-size:0.65rem;letter-spacing:2px;color:var(--green-light);">
                            MATERIAS PRIMAS
                        </span>
                    </div>
                <?php endif; ?>

                <p><?php echo esc_html(get_bloginfo('description') ?: 'Materias primas farmacéuticas y cosméticas de alta calidad. Más de 15 años al servicio de la industria colombiana.'); ?></p>

                <div class="footer-social">
                    <?php
                    $socials = [
                        'https://www.instagram.com/mckennagroup.co/' => 'ph-instagram-logo',
                        'https://wa.me/573001234567'                  => 'ph-whatsapp-logo',
                        'https://www.linkedin.com/company/mckennagroup' => 'ph-linkedin-logo',
                        'https://www.facebook.com/mckennagroup.co'   => 'ph-facebook-logo',
                    ];
                    foreach ($socials as $url => $icon):
                    ?>
                    <a href="<?php echo esc_url($url); ?>" target="_blank" rel="noopener">
                        <i class="ph <?php echo esc_attr($icon); ?>"></i>
                    </a>
                    <?php endforeach; ?>
                </div>
            </div>

            <!-- Columna 2: Categorías -->
            <div class="footer-col">
                <h4>Categorías</h4>
                <ul>
                    <?php
                    $cats = get_terms([
                        'taxonomy'   => 'product_cat',
                        'hide_empty' => true,
                        'number'     => 8,
                        'orderby'    => 'count',
                        'order'      => 'DESC',
                        'parent'     => 0,
                    ]);
                    if (!is_wp_error($cats) && $cats):
                        foreach ($cats as $cat):
                    ?>
                    <li>
                        <a href="<?php echo esc_url(get_term_link($cat)); ?>">
                            <?php echo esc_html($cat->name); ?>
                        </a>
                    </li>
                    <?php endforeach; endif; ?>
                </ul>
            </div>

            <!-- Columna 3: Información -->
            <div class="footer-col">
                <h4>Información</h4>
                <ul>
                    <?php
                    wp_nav_menu([
                        'theme_location' => 'footer',
                        'container'      => false,
                        'items_wrap'     => '%3$s',
                        'fallback_cb'    => function() {
                            $links = [
                                home_url('/nosotros/')                         => 'Sobre Nosotros',
                                home_url('/terminos-y-condiciones/')           => 'Términos y Condiciones',
                                home_url('/politica-de-privacidad/')           => 'Política de Privacidad',
                                function_exists('wc_get_page_id') ? get_permalink(wc_get_page_id('shop')) : '#' => 'Tienda',
                                home_url('/contacto/')                         => 'Contacto',
                                home_url('/preguntas-frecuentes/')             => 'Preguntas Frecuentes',
                            ];
                            foreach ($links as $url => $label) {
                                echo '<li><a href="' . esc_url($url) . '">' . esc_html($label) . '</a></li>';
                            }
                        },
                    ]);
                    ?>
                </ul>
            </div>

            <!-- Columna 4: Contacto -->
            <div class="footer-col footer-contact">
                <h4>Contacto</h4>
                <p>
                    <i class="ph ph-map-pin icon"></i>
                    Bogotá, Colombia — Despachos a nivel nacional
                </p>
                <p>
                    <i class="ph ph-phone icon"></i>
                    <a href="tel:+573001234567" style="color:rgba(255,255,255,0.6)">+57 (300) 123-4567</a>
                </p>
                <p>
                    <i class="ph ph-envelope icon"></i>
                    <a href="mailto:ventas@mckennagroup.co" style="color:rgba(255,255,255,0.6)">ventas@mckennagroup.co</a>
                </p>
                <p>
                    <i class="ph ph-clock icon"></i>
                    Lun – Vie 8:00 – 17:30
                </p>

                <!-- WhatsApp CTA -->
                <a href="https://wa.me/573001234567?text=Hola%2C%20quiero%20información%20sobre%20sus%20productos"
                   target="_blank"
                   class="btn btn-primary btn-sm"
                   style="margin-top:16px;display:inline-flex;">
                    <i class="ph ph-whatsapp-logo"></i>
                    Escribir por WhatsApp
                </a>
            </div>

        </div><!-- .footer-main -->

        <!-- Footer bottom -->
        <div class="footer-bottom">
            <span>
                &copy; <?php echo date('Y'); ?>
                <a href="<?php echo esc_url(home_url('/')); ?>">McKenna Group S.A.S.</a>
                — Todos los derechos reservados.
            </span>
            <span>
                NIT: (Tu NIT aquí) &nbsp;·&nbsp;
                <a href="<?php echo esc_url(home_url('/politica-de-privacidad/')); ?>">Privacidad</a> &nbsp;·&nbsp;
                <a href="<?php echo esc_url(home_url('/terminos-y-condiciones/')); ?>">Términos</a>
            </span>
        </div>

    </div><!-- .container -->
</footer>

<?php wp_footer(); ?>
</body>
</html>
