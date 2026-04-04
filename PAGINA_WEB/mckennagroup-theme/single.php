<?php get_header(); ?>

<section class="page-hero">
    <div class="container">
        <?php while (have_posts()): the_post(); ?>
        <h1><?php the_title(); ?></h1>
        <p style="color:var(--text-muted);">
            <?php echo esc_html(get_the_date()); ?> &nbsp;·&nbsp;
            <?php the_category(', '); ?>
        </p>
        <?php endwhile; ?>
        <?php rewind_posts(); ?>
    </div>
</section>

<div class="container page-content">
    <div class="shop-layout">
        <main class="shop-main">
            <?php while (have_posts()): the_post(); ?>
            <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
                <?php if (has_post_thumbnail()): ?>
                <div style="margin-bottom:32px;border-radius:var(--radius-lg);overflow:hidden;">
                    <?php the_post_thumbnail('full', ['style' => 'width:100%;max-height:480px;object-fit:cover;']); ?>
                </div>
                <?php endif; ?>
                <div class="entry-content"><?php the_content(); ?></div>
                <div style="margin-top:40px;padding-top:24px;border-top:1px solid var(--border);">
                    <?php the_post_navigation(['prev_text' => '← %title', 'next_text' => '%title →']); ?>
                </div>
            </article>
            <?php endwhile; ?>
        </main>
        <aside class="shop-sidebar">
            <?php dynamic_sidebar('blog-sidebar'); ?>
        </aside>
    </div>
</div>

<?php get_footer(); ?>
