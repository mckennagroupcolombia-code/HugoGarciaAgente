<?php get_header(); ?>

<!-- Page Hero: oscuro y premium -->
<section class="page-hero">
    <div class="container">
        <?php while (have_posts()): the_post(); ?>
        <span class="page-hero-badge">McKenna Group</span>
        <h1><?php the_title(); ?></h1>
        <?php if (has_excerpt()): ?>
        <p><?php the_excerpt(); ?></p>
        <?php endif; ?>
        <?php endwhile; ?>
        <?php rewind_posts(); ?>
    </div>
</section>

<div class="container page-content">
    <?php while (have_posts()): the_post(); ?>
    <article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
        <?php if (has_post_thumbnail()): ?>
        <div style="margin-bottom:40px;border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-md);">
            <?php the_post_thumbnail('full', ['style' => 'width:100%;max-height:480px;object-fit:cover;']); ?>
        </div>
        <?php endif; ?>
        <div class="entry-content" style="max-width:860px;">
            <?php the_content(); ?>
        </div>
    </article>
    <?php endwhile; ?>
</div>

<?php get_footer(); ?>
